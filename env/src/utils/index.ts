import { randomInt } from 'node:crypto';

export const pickOne = <T>(list: T[]) => {
  return list[randomInt(0, list.length)];
};
