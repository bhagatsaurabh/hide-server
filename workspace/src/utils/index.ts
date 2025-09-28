import { randomBytes } from 'node:crypto';

const CHARSPACE = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export const accessCode = (length = 16) => {
  const charSpace = CHARSPACE;
  const out: string[] = [];
  const charSpaceLen = charSpace.length;
  const maxValid = 256 - (256 % charSpaceLen);

  while (out.length < length) {
    const bytes = randomBytes(32);
    for (let i = 0; i < bytes.length && out.length < length; i++) {
      const b = bytes[i];
      if (b >= maxValid) continue;
      out.push(charSpace[b % charSpaceLen]);
    }
  }
  return out.join('');
};
