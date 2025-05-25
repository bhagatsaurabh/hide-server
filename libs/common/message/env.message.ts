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
export interface EnvWorkspaceOpen extends InSocketMessageEnv {
  sessionId: string;
}

////////////////

export interface EnvWorkspaceOpened extends OutSocketMessagePayload {}
export interface EnvWorkspaceOpenWait extends OutSocketMessagePayload {}
export interface EnvSessionLost extends OutSocketMessagePayload {}
export interface EnvError extends OutSocketMessagePayload {
  code: string;
}

export type EnvResponseMap = {
  "session.lost": EnvSessionLost;
  "workspace.opened": EnvWorkspaceOpened;
  "workspace.open.wait": EnvWorkspaceOpenWait;
  error: EnvError;
};
export type EnvPayload = {
  [K in keyof EnvResponseMap]: {
    action: K;
    payload: EnvResponseMap[K];
  };
}[keyof EnvResponseMap];
