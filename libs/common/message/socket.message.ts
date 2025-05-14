export type InSocketMessageService = string | "env";
export type InSocketMessagePayload = Record<string, unknown>;
export interface InSocketMessageEnv extends InSocketMessagePayload {
  uuid: string;
}
export type InSocketMessagePayloadMap = {
  env: InSocketMessageEnv;
};
export type SSHAction =
  | "ssh.request"
  | "ssh.data"
  | "ssh.close"
  | "ssh.closeall";
export type FSAction = "fs.sync" | "fs.close";
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

export type SocketMessagePayload = {
  [k: string]: unknown;
  action: string;
};
