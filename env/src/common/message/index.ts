/* import { SocketMessagePayload } from './socket.message';

export interface Message<T = any> {
  meta: {
    requestId: string;
    timestamp: number;
    uid: string;
    route: string;
  };
  payload: T;
}

type FSRequest = {
  path: string;
};
export type FSOpenRequest = FSRequest;
export type FSCloseRequest = FSRequest;
export type FSSaveRequest = FSRequest;

export type FSEventType = 'create' | 'remove' | 'rename' | 'write';

export type FSEvent = {
  watchedPath: string;
  path: string;
  oldPath?: string;
  ino?: number;
  action: FSEventType;
  timestamp: number;
  type: 'file' | 'dir';
};
export interface FSEventBatch extends SocketMessagePayload {
  events: FSEvent[];
}

export interface FSBlock extends SocketMessagePayload {
  path: string;
}
export type FSResume = FSBlock;

export interface FSSync extends SocketMessagePayload {
  uuid: string;
  path: string;
  buf: string;
}

export type FSDocSyncEvent = {
  path: string;
  buf: string;
};

export type EnvPayload = {
  uuid: string;
  [k: string]: unknown;
};

export type EnvPingEvent = EnvPayload;
 */
