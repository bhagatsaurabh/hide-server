import { InSocketMessageEnv } from "./env.message";
import { OutSocketMessagePayload } from "./socket.message";

export type SSHAction =
  | "ssh.request"
  | "ssh.data"
  | "ssh.close"
  | "ssh.closeall";

export interface SSHRequest extends InSocketMessageEnv {
  privateKey: string;
}
export interface SSHData extends InSocketMessageEnv {
  sshSessionId: string;
  input: string;
}
export interface SSHClose extends InSocketMessageEnv {
  sshSessionId: "#all" | string;
}

///////////

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
  sshSessionId: string;
}
export interface SSHOutput extends OutSocketMessagePayload {
  sshSessionId: string;
  output: string;
}
export interface SSHError extends OutSocketMessagePayload {
  message: string;
}
export interface SSHClosed extends OutSocketMessagePayload {
  sshSessionId: string;
  all?: boolean;
}
