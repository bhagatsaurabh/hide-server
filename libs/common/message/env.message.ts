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
  path: string;
}

////////////////

export interface EnvWorkspaceOpened extends OutSocketMessagePayload {}
export interface EnvWorkspaceOpenWait extends OutSocketMessagePayload {}
export interface EnvSessionLost extends OutSocketMessagePayload {}
export interface EnvError extends OutSocketMessagePayload {
  code: string;
}

export type EnvResponseMap = {
  error: EnvError;
};
export type EnvPayload = {
  [K in keyof EnvResponseMap]: {
    action: K;
    payload: EnvResponseMap[K];
  };
}[keyof EnvResponseMap];
