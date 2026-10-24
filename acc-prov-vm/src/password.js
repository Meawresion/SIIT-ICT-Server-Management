// Generates the one password a student gets for a new service (and the VPN when it is new, D15).
// Letters and digits only, without look-alikes (0/O, 1/l/I), so it is safe to type and to pass
// through pfSense, chpasswd and HUE without escaping, and easy to read from the password image.

import { randomInt } from 'node:crypto';

const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const LOWER = 'abcdefghijkmnopqrstuvwxyz';
const DIGITS = '23456789';
const ALL = UPPER + LOWER + DIGITS;
export const MIN_PASSWORD_LENGTH = 14;

export function generatePassword(length) {
  if (!Number.isInteger(length) || length < MIN_PASSWORD_LENGTH || length > 128) {
    throw new Error(`password length must be an integer from ${MIN_PASSWORD_LENGTH} to 128`);
  }
  // At least one of each class, the rest from the full alphabet, then shuffle (Fisher-Yates).
  const chars = [UPPER, LOWER, DIGITS].map((set) => set[randomInt(set.length)]);
  while (chars.length < length) chars.push(ALL[randomInt(ALL.length)]);
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}
