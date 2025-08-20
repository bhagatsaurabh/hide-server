import { WorkspaceDTO } from "../dto";
import {
  InSocketMessagePayload,
  OutSocketMessagePayload,
} from "./socket.message";

export type EnvAction = "ping";

export interface InSocketMessageEnv extends InSocketMessagePayload {
  uuid: string;
}

export interface EnvPing extends InSocketMessageEnv {}

export interface EnvUserDisconnect extends InSocketMessageEnv {
  uid: string;
  sessionId: string;
}
export interface InternalWorkspaceOpen extends InSocketMessageEnv {
  sessionId: string;
}
export interface InternalWorkspaceClose extends InSocketMessageEnv {
  sessionId: string;
  uid: string;
}
export interface InternalDocHash extends InSocketMessageEnv {
  uuid: string;
  ino: number;
}

////////////////

export interface EnvWorkspaceOpened extends OutSocketMessagePayload {}
export interface EnvWorkspaceOpenWait extends OutSocketMessagePayload {}
export interface EnvSessionLost extends OutSocketMessagePayload {}
export interface EnvDisconnect extends OutSocketMessagePayload {
  code: string;
}
export interface EnvError extends OutSocketMessagePayload {
  code: string;
}
export interface EnvAwareness extends OutSocketMessagePayload {
  uids: string[];
}

export type EnvResponseMap = {
  disconnect: EnvDisconnect;
  error: EnvError;
  awareness: EnvAwareness;
};
export type EnvPayload = {
  [K in keyof EnvResponseMap]: {
    action: K;
    payload: EnvResponseMap[K];
  };
}[keyof EnvResponseMap];

///////////////

export interface ProvisionStatus extends InSocketMessagePayload {
  message: string;
}
export interface ProvisionError extends InSocketMessagePayload {
  message: string;
}
export interface ProvisionSuccess extends InSocketMessagePayload {
  message: string;
  privateKey: string;
  workspace: WorkspaceDTO;
}
export interface ProvisionReady extends InSocketMessagePayload {
  message: string;
}

export type ProvisionResponseMap = {
  status: ProvisionStatus;
  error: ProvisionError;
  success: ProvisionSuccess;
  ready: ProvisionReady;
};
export type ProvisionPayload = {
  [K in keyof ProvisionResponseMap]: {
    action: K;
    payload: ProvisionResponseMap[K];
  };
}[keyof ProvisionResponseMap];

////////////////////

export interface CommandMap {
  "file.new": { name: string };
  "folder.new": { name: string };
}
export interface WSRun<K extends keyof CommandMap> extends InSocketMessageEnv {
  command: K;
  ctx: CommandMap[K];
}
