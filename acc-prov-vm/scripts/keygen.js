// Generates one message key bundle (D22): npm run keygen -- <kid>
// e.g. npm run keygen -- site-2026-10
// Prints the private bundle (put it in THIS side's .env as MSG_PRIVATE_KEY, nowhere else) and the
// public bundle (give it to the other side: MSG_PEER_PUBLIC_KEYS there, or Secrets Manager on AWS).

import { generateKeyBundle } from '../src/envelope.js';

const kid = process.argv[2];
if (!kid) {
  console.error('usage: npm run keygen -- <kid>   (lowercase letters, digits, -; e.g. site-2026-10)');
  process.exit(2);
}
const { privateBundle, publicBundle } = generateKeyBundle(kid);
console.log('# PRIVATE: this side only (.env). Never commit, never send in chat or email.');
console.log(`MSG_PRIVATE_KEY=${privateBundle}`);
console.log('');
console.log('# PUBLIC: give to the other side (its MSG_PEER_PUBLIC_KEYS, or Secrets Manager on AWS).');
console.log(publicBundle);
