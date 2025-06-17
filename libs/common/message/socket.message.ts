import {
  EnvPayload,
  EnvUserDisconnect,
  InternalWorkspaceOpen,
  InSocketMessageEnv,
  InternalWorkspaceClose,
  InternalDocHash,
} from "./env.message";
import {
  FSClose,
  FSDirEntries,
  FSFile,
  FSNoop,
  FSOpen,
  FSPayload,
  FSSyncIn,
  InternalWorkspaceWatch,
} from "./filesystem.message";
import { NotificationPayload } from "./notification.message";
import { InternalPresencePing, PresencePing } from "./presence.message";
import { SSHClose, SSHData, SSHPayload, SSHRequest } from "./ssh.message";

export type OutSocketMessageActionMap = {
  ssh: SSHPayload;
  notification: NotificationPayload;
  fs: FSPayload;
  env: EnvPayload;
} & {
  [key: string]: {
    action: "success" | "error";
    payload: FSDirEntries | FSFile | FSNoop | OutSocketMessagePayload;
  };
};
export type OutSocketMessagePayloadError = { code: string };
export type OutSocketMessagePayload = {
  correlationId?: string;
  error?: OutSocketMessagePayloadError;
  [key: string]: unknown;
};

export type OutSocketMessage<K extends keyof OutSocketMessageActionMap> =
  OutSocketMessageActionMap[K];

/////////////////////

export type InSocketMessagePayload = Record<string, unknown>;
export type InSocketMessagePayloadActionMap = {
  env: InSocketMessageEnv;
};
export type EnforcedInSocketMessagePayloadActionMap<
  T extends {
    [K in keyof InSocketMessagePayloadActionMap]: {
      [Sub in string]: InSocketMessagePayloadActionMap[K];
    };
  }
> = T;
export type InSocketMessagePayloadMap =
  EnforcedInSocketMessagePayloadActionMap<{
    env: {
      "ssh.request": SSHRequest;
      "ssh.data": SSHData;
      "ssh.close": SSHClose;
      "fs.open": FSOpen;
      "fs.sync": FSSyncIn;
      "fs.close": FSClose;
    };
    presence: {
      "session.ping": PresencePing;
    };
    internal: {
      "workspace.watch": InternalWorkspaceWatch;
      "doc.hash": InternalDocHash;
    };
  }>;

export type InSocketMessageMap<
  T extends keyof InSocketMessagePayloadMap = keyof InSocketMessagePayloadMap,
  S extends keyof InSocketMessagePayloadMap[T] = keyof InSocketMessagePayloadMap[T]
> = {
  service: T;
  action: S;
  payload: InSocketMessagePayloadMap[T][S];
};

export type InSocketMessage<
  T extends keyof InSocketMessagePayloadMap = keyof InSocketMessagePayloadMap
> = {
  [K in T]: {
    [S in keyof InSocketMessagePayloadMap[K]]: {
      service: K;
      action: S;
      payload: InSocketMessagePayloadMap[K][S];
      correlationId?: string;
    };
  }[keyof InSocketMessagePayloadMap[K]];
}[T];
