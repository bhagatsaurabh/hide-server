import { randomUUID } from 'node:crypto';
import { Message } from 'hide-common';

export const createMessage = <T>(uid: string, path: string, payload: T): Message<T> => ({
  meta: {
    requestId: randomUUID(),
    route: path,
    timestamp: performance.now(),
    uid,
  },
  payload,
});
