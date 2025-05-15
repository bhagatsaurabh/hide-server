import { FSAction } from "./filesystem.message";
import { NotificationPayload } from "./notification.message";
import { SSHAction, SSHPayload } from "./ssh.message";

export type InSocketMessageService = string | "env";
export type InSocketMessagePayload = Record<string, unknown>;
export interface InSocketMessageEnv extends InSocketMessagePayload {
  uuid: string;
}
export type InSocketMessagePayloadMap = {
  env: InSocketMessageEnv;
};

export type EnvAction = "ping";
export type InSocketMessageActionMap = {
  env: EnvAction | SSHAction | FSAction;
};
export type InSocketMessage<
  K extends keyof InSocketMessagePayloadMap,
  P extends InSocketMessagePayloadMap[K]
> = {
  service: K;
  action: InSocketMessageActionMap[K];
  payload: P;
};

export type OutSocketMessageActionMap = {
  ssh: SSHPayload;
  notification: NotificationPayload;
};
export type OutSocketMessagePayload = {
  [key: string]: unknown;
};

export type OutSocketMessage<K extends keyof OutSocketMessageActionMap> =
  OutSocketMessageActionMap[K];
