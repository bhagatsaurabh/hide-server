import { OutSocketMessagePayload } from "./socket.message";

export type SessionPayloadMap = {
  error: SessionErrorPayload;
};
export type SessionPayload = {
  [K in keyof SessionPayloadMap]: {
    action: K;
    payload: SessionPayloadMap[K];
  };
}[keyof SessionPayloadMap];

export interface SessionErrorPayload extends OutSocketMessagePayload {}
