import { OutSocketMessage, OutSocketMessageActionMap, SocketMessagePayload } from './socket.message';

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

export interface FSExtEvent extends FSEvent {
  uids: string[];
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

///////////////////

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export type ServiceEventPayload = {};
export interface ServiceEvent<T extends ServiceEventPayload> {
  meta?: {
    requestId?: string;
    timestamp?: number;
    uid?: string;
    route?: string;
  };
  payload: T;
}

export interface SocketSend<K extends keyof OutSocketMessageActionMap> extends ServiceEventPayload {
  uid: string;
  pattern: string;
  msg: OutSocketMessage<K>;
}

export interface SocketBroadcast<K extends keyof OutSocketMessageActionMap> extends ServiceEventPayload {
  uids: string[];
  pattern: string;
  msg: OutSocketMessage<K>;
}
