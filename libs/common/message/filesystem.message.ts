import { FSOpenDTO } from "../dto";
import { InSocketMessageEnv } from "./env.message";
import { OutSocketMessagePayload } from "./socket.message";

export type FSEventType = "create" | "remove" | "rename" | "write";
export type FSEvent = {
  watchedPath: string;
  path: string;
  oldPath?: string;
  ino?: number;
  action: FSEventType;
  timestamp: number;
  type: "file" | "dir";
};

export interface FSEventBatch extends OutSocketMessagePayload {
  events: FSEvent[];
}
export interface FSDirEntries extends OutSocketMessagePayload {
  entries: FSOpenDTO[];
}
export interface FSFile extends OutSocketMessagePayload {
  content: string;
}
export type FSNoop = OutSocketMessagePayload;
export interface FSBlock extends OutSocketMessagePayload {
  path: string;
}
export type FSResume = FSBlock;
export type FSLost = FSBlock;
export interface FSSync extends OutSocketMessagePayload {
  uuid: string;
  ino: number;
  buf: string;
}
export interface FSFileDisplaced extends OutSocketMessagePayload {
  ino: number;
  uuid: string;
}

export type FSResponseMap = {
  batch: FSEventBatch;
  block: FSBlock;
  resume: FSResume;
  sync: FSSync;
  lost: FSLost;
  displaced: FSFileDisplaced;
};
export type FSPayload = {
  [K in keyof FSResponseMap]: {
    action: K;
    payload: FSResponseMap[K];
  };
}[keyof FSResponseMap];

///////

export interface FSSyncIn extends InSocketMessageEnv {
  ino: number;
  buf: string;
}

export interface FSOpen extends InSocketMessageEnv {
  path: string;
}
export interface FSOpenAck extends InSocketMessageEnv {
  ino: number;
}

export interface FSClose extends InSocketMessageEnv {
  path: string;
  ino?: number;
}

/////

export type InternalWorkspaceWatch = {
  event: FSEvent;
  uuid: string;
};
