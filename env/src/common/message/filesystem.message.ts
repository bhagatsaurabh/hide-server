import { OutSocketMessagePayload } from './socket.message';

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

export interface FSEventBatch extends OutSocketMessagePayload {
  events: FSEvent[];
}
export interface FSBlock extends OutSocketMessagePayload {
  path: string;
}
export type FSResume = FSBlock;
export interface FSSync extends OutSocketMessagePayload {
  uuid: string;
  path: string;
  buf: string;
}

export type FSResponseMap = {
  batch: FSEventBatch;
  block: FSBlock;
  resume: FSResume;
  sync: FSSync;
};
export type FSPayload = {
  [K in keyof FSResponseMap]: {
    action: K;
    payload: FSResponseMap[K];
  };
}[keyof FSResponseMap];
