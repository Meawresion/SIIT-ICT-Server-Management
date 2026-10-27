import { createHmac, timingSafeEqual } from 'node:crypto';

// A minimal HS256 JWT (RFC 7519) on node:crypto. The backend is the only issuer and the only
// reader, so the header is fixed: a token with any other header (alg "none", RS256, ...) is refused.
const HEADER = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');

const mac = (data, secret) => createHmac('sha256', secret).update(data).digest('base64url');

export function signToken(claims, secret) {
  const body = `${HEADER}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}`;
  return `${body}.${mac(body, secret)}`;
}

// Returns the claims, or null when the token is malformed, signed with another key or expired.
export function verifyToken(token, secret, now = Date.now()) {
  const parts = typeof token === 'string' ? token.split('.') : [];
  if (parts.length !== 3 || parts[0] !== HEADER) return null;
  const expected = Buffer.from(mac(`${parts[0]}.${parts[1]}`, secret));
  const actual = Buffer.from(parts[2]);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (typeof claims?.exp !== 'number' || claims.exp * 1000 <= now) return null;
    return claims;
  } catch {
    return null;
  }
}
