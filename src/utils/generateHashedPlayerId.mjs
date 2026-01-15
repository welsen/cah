import crypto from 'crypto';

export function generateHashedPlayerId(length = 10) {
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  const targetLength = length;
  const out = [];

  while (out.length < targetLength) {
    const bytes = crypto.randomBytes(targetLength - out.length);
    for (let i = 0; i < bytes.length && out.length < targetLength; i++) {
      const v = bytes[i];
      if (v < 234) {
        out.push(letters[v % 26]);
      }
    }
  }

  const id = out.join('');
  return `u${id.slice(0, 7)}-${id.slice(7, length)}`;
}
