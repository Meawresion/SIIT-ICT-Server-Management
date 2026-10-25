// Signed + encrypted message envelope (D22), the same on every transport (local ActiveMQ, SQS).
//
// - Each side has one key bundle: an Ed25519 signing key and an X25519 encryption key, with a kid.
//     private bundle: "<kid>.<ed25519 private>.<x25519 private>"   (this side's .env only)
//     public bundle:  "<kid>.<ed25519 public>.<x25519 public>"     (given to the other side)
//   Keys are raw 32-byte values, base64url. Several public bundles (comma-separated) can be
//   accepted at once during a key rotation; the first one is used for sending.
// - Encryption: ephemeral X25519 + ECDH with the recipient's key -> HKDF-SHA256 -> AES-256-GCM,
//   with the header as AAD. The sender signs header + iv + ciphertext + tag with Ed25519.
// - The receiver checks shape, kids and time window, verifies the signature, then decrypts.
//   Duplicate jti (job_id) detection belongs to the caller.

import {
  createCipheriv, createDecipheriv, createPrivateKey, createPublicKey, diffieHellman, generateKeyPairSync,
  hkdfSync, randomBytes, sign, verify,
} from 'node:crypto';

const KID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const B64URL_32 = /^[A-Za-z0-9_-]{43}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TYPES = ['job', 'result'];
const MAX_ENVELOPE_BYTES = 256 * 1024; // SQS message limit
const HKDF_INFO = Buffer.from('acc-prov-vm envelope v1');

export class EnvelopeError extends Error {}

const b64 = (buf) => Buffer.from(buf).toString('base64url');
const unb64 = (s, what) => {
  if (typeof s !== 'string' || !/^[A-Za-z0-9_-]+$/.test(s)) throw new EnvelopeError(`bad ${what}`);
  return Buffer.from(s, 'base64url');
};

function rawPublic(keyObject) {
  return Buffer.from(keyObject.export({ format: 'jwk' }).x, 'base64url');
}

function rawPrivate(keyObject) {
  return Buffer.from(keyObject.export({ format: 'jwk' }).d, 'base64url');
}

function publicKeyFromRaw(crv, raw) {
  return createPublicKey({ key: { kty: 'OKP', crv, x: b64(raw) }, format: 'jwk' });
}

function privateKeyFromRaw(crv, raw) {
  // Raw 32-byte private key wrapped in the fixed PKCS#8 DER prefix for the curve (RFC 8410).
  const pkcs8Prefix = {
    Ed25519: Buffer.from('302e020100300506032b657004220420', 'hex'),
    X25519: Buffer.from('302e020100300506032b656e04220420', 'hex'),
  }[crv];
  return createPrivateKey({ key: Buffer.concat([pkcs8Prefix, raw]), format: 'der', type: 'pkcs8' });
}

export function generateKeyBundle(kid) {
  if (!KID_RE.test(kid ?? '')) throw new EnvelopeError(`kid must match ${KID_RE}`);
  const s = generateKeyPairSync('ed25519');
  const e = generateKeyPairSync('x25519');
  return {
    privateBundle: `${kid}.${b64(rawPrivate(s.privateKey))}.${b64(rawPrivate(e.privateKey))}`,
    publicBundle: `${kid}.${b64(rawPublic(s.publicKey))}.${b64(rawPublic(e.publicKey))}`,
  };
}

function splitBundle(bundle, what) {
  const parts = typeof bundle === 'string' ? bundle.trim().split('.') : [];
  if (parts.length !== 3 || !KID_RE.test(parts[0]) || !B64URL_32.test(parts[1]) || !B64URL_32.test(parts[2])) {
    throw new EnvelopeError(`${what} must look like <kid>.<43 base64url chars>.<43 base64url chars>`);
  }
  return parts;
}

// -> { kid, signPrivate, encPrivate, signPublic, encPublic, publicBundle }
export function parsePrivateBundle(bundle) {
  const [kid, s, e] = splitBundle(bundle, 'private key bundle');
  const signPrivate = privateKeyFromRaw('Ed25519', Buffer.from(s, 'base64url'));
  const encPrivate = privateKeyFromRaw('X25519', Buffer.from(e, 'base64url'));
  const signPublic = createPublicKey(signPrivate);
  const encPublic = createPublicKey(encPrivate);
  return {
    kid, signPrivate, encPrivate, signPublic, encPublic,
    publicBundle: `${kid}.${b64(rawPublic(signPublic))}.${b64(rawPublic(encPublic))}`,
  };
}

// "b1,b2" -> [{ kid, signPublic, encPublic }]  (first = current, used for sending)
export function parsePublicBundles(list) {
  const items = (list ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  if (!items.length) throw new EnvelopeError('no peer public key bundles configured');
  const seen = new Set();
  return items.map((b) => {
    const [kid, s, e] = splitBundle(b, 'public key bundle');
    if (seen.has(kid)) throw new EnvelopeError(`duplicate peer kid ${kid}`);
    seen.add(kid);
    return {
      kid,
      signPublic: publicKeyFromRaw('Ed25519', Buffer.from(s, 'base64url')),
      encPublic: publicKeyFromRaw('X25519', Buffer.from(e, 'base64url')),
    };
  });
}

// Fixed field order, so both sides produce identical bytes.
function headerBytes(h) {
  return Buffer.from(JSON.stringify([h.v, h.typ, h.kid, h.rkid, h.jti, h.rid, h.iat, h.exp, h.epk]));
}

function signingInput(h, iv, ct, tag) {
  return Buffer.concat([headerBytes(h), Buffer.from(`.${iv}.${ct}.${tag}`)]);
}

function deriveKey(shared, epkRaw, recipientEncPublicRaw) {
  return Buffer.from(hkdfSync('sha256', shared, Buffer.concat([epkRaw, recipientEncPublicRaw]), HKDF_INFO, 32));
}

// me: parsePrivateBundle(...), peer: one entry of parsePublicBundles(...). -> JSON string
export function seal({ typ, jti, rid, payload, ttlSec, now = Date.now() }, { me, peer }) {
  if (!TYPES.includes(typ)) throw new EnvelopeError(`typ must be one of ${TYPES.join(', ')}`);
  if (!UUID_RE.test(jti ?? '')) throw new EnvelopeError('jti must be a lowercase UUID');
  if (!Number.isSafeInteger(rid) || rid < 0) throw new EnvelopeError('rid must be a non-negative integer');
  if (!Number.isInteger(ttlSec) || ttlSec <= 0) throw new EnvelopeError('ttlSec must be a positive integer');

  const iat = Math.floor(now / 1000);
  const eph = generateKeyPairSync('x25519');
  const epkRaw = rawPublic(eph.publicKey);
  const shared = diffieHellman({ privateKey: eph.privateKey, publicKey: peer.encPublic });
  const key = deriveKey(shared, epkRaw, rawPublic(peer.encPublic));

  const h = { v: 1, typ, kid: me.kid, rkid: peer.kid, jti, rid, iat, exp: iat + ttlSec, epk: b64(epkRaw) };
  const ivBuf = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, ivBuf);
  cipher.setAAD(headerBytes(h));
  const ctBuf = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  const iv = b64(ivBuf);
  const ct = b64(ctBuf);
  const tag = b64(cipher.getAuthTag());
  const sig = b64(sign(null, signingInput(h, iv, ct, tag), me.signPrivate));
  return JSON.stringify({ ...h, iv, ct, tag, sig });
}

// -> { typ, jti, rid, iat, exp, kid, payload }. Throws EnvelopeError on anything wrong.
export function open(text, { me, peers, expectedTyp, now = Date.now(), maxSkewSec = 300, maxTtlSec }) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_ENVELOPE_BYTES) throw new EnvelopeError('envelope too large or not text');
  let env;
  try {
    env = JSON.parse(text);
  } catch {
    throw new EnvelopeError('envelope is not JSON');
  }
  const { v, typ, kid, rkid, jti, rid, iat, exp, epk, iv, ct, tag, sig } = env ?? {};
  if (v !== 1) throw new EnvelopeError('unsupported envelope version');
  if (typ !== expectedTyp) throw new EnvelopeError(`unexpected typ ${typ}`);
  const peer = peers.find((p) => p.kid === kid);
  if (!peer) throw new EnvelopeError(`unknown sender kid ${kid}`);
  if (rkid !== me.kid) throw new EnvelopeError(`envelope is for kid ${rkid}, not ${me.kid}`);
  if (!UUID_RE.test(jti ?? '')) throw new EnvelopeError('bad jti');
  if (!Number.isSafeInteger(rid) || rid < 0) throw new EnvelopeError('bad rid');
  if (!Number.isInteger(iat) || !Number.isInteger(exp) || exp <= iat) throw new EnvelopeError('bad iat/exp');
  const nowSec = Math.floor(now / 1000);
  if (iat > nowSec + maxSkewSec) throw new EnvelopeError('envelope issued in the future');
  if (exp <= nowSec) throw new EnvelopeError('envelope expired');
  if (maxTtlSec !== undefined && exp - iat > maxTtlSec) throw new EnvelopeError('envelope lifetime too long');

  const h = { v, typ, kid, rkid, jti, rid, iat, exp, epk };
  const sigBuf = unb64(sig, 'sig');
  const okSig = verify(null, signingInput(h, iv, ct, tag), peer.signPublic, sigBuf);
  if (!okSig) throw new EnvelopeError('bad signature');

  const epkRaw = unb64(epk, 'epk');
  if (epkRaw.length !== 32) throw new EnvelopeError('bad epk');
  const shared = diffieHellman({ privateKey: me.encPrivate, publicKey: publicKeyFromRaw('X25519', epkRaw) });
  const key = deriveKey(shared, epkRaw, rawPublic(me.encPublic));
  let plaintext;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, unb64(iv, 'iv'));
    decipher.setAAD(headerBytes(h));
    decipher.setAuthTag(unb64(tag, 'tag'));
    plaintext = Buffer.concat([decipher.update(unb64(ct, 'ct')), decipher.final()]).toString('utf8');
  } catch {
    throw new EnvelopeError('decryption failed');
  }
  return { typ, jti, rid, iat, exp, kid, payload: JSON.parse(plaintext) };
}
