import { InSocketMessageEnv, OutSocketMessagePayload } from "./socket.message";

export type SSHAction =
  | "ssh.request"
  | "ssh.data"
  | "ssh.close"
  | "ssh.closeall";

export interface SSHRequest extends InSocketMessageEnv {
  privateKey: string;
}
export interface SSHData extends InSocketMessageEnv {
  sessionId: string;
  input: string;
}
export interface SSHClose extends InSocketMessageEnv {
  sessionId: string;
}
export type SSHCloseAll = InSocketMessageEnv;

export type SSHResponseMap = {
  open: SSHOpen;
  output: SSHOutput;
  error: SSHError;
  closed: SSHClosed;
};
export type SSHPayload = {
  [K in keyof SSHResponseMap]: {
    action: K;
    payload: SSHResponseMap[K];
  };
}[keyof SSHResponseMap];

export interface SSHOpen extends OutSocketMessagePayload {
  sessionId: string;
}
export interface SSHOutput extends OutSocketMessagePayload {
  sessionId: string;
  output: string;
}
export interface SSHError extends OutSocketMessagePayload {
  message: string;
}
export interface SSHClosed extends OutSocketMessagePayload {
  sessionId: string;
}
