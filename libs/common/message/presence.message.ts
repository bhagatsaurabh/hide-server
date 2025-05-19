import { InSocketMessagePayload } from "./socket.message";

export type PresenceAction = "ping";

export interface InSocketMessagePresence extends InSocketMessagePayload {
  uuid: string | "";
}

export type PresencePing = InSocketMessagePresence;
