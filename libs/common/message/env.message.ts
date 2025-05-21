import { InSocketMessagePayload } from "./socket.message";

export type EnvAction = "ping";

export interface InSocketMessageEnv extends InSocketMessagePayload {
  uuid: string;
}

export interface EnvPing extends InSocketMessageEnv {}

export interface EnvUserDisconnect extends InSocketMessageEnv {
  uid: string;
}
