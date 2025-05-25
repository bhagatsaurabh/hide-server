import { InSocketMessagePayload } from "./socket.message";

export type PresenceAction = "ping";

export interface PresencePing extends InSocketMessagePayload {
  uuid?: string;
}

export interface InternalPresencePing extends InSocketMessagePayload {
  uid: string;
  sessionId: string;
  uuid: string;
}
