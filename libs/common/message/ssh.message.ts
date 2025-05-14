import { InSocketMessageEnv } from "./socket.message";

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
