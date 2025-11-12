import { randomUUID } from "node:crypto";
import { UserNotificationPayload } from "./notification.message";
import { OutSocketMessage, OutSocketMessageActionMap } from "./socket.message";
import { StatDTO } from "dto";

export * from "./notification.message";
export * from "./socket.message";
export * from "./workspace.message";
export * from "./gateway.message";
export * from "./session.message";

export enum ExtTransport {
  HTTP = 998,
  WS = 999,
}
export type HttpMethod =
  | "GET"
  | "PUT"
  | "POST"
  | "DELETE"
  | "PATCH"
  | "OPTIONS";

export interface ServiceMessage<T extends ServiceMessagePayload> {
  meta?: {
    uid: string;
    sessionId?: string;
    requestId?: string;
    timestamp?: number;
    route?: string;
  };
  payload: T;
}
export type ServiceMessagePayload = {
  reqAction?: string;
  [key: string]: unknown;
};

export const createMessage = <T extends ServiceMessagePayload>(
  uid: string,
  route: string,
  payload: T
): ServiceMessage<T> => ({
  meta: {
    uid,
    route,
    requestId: randomUUID(),
    timestamp: performance.now(),
  },
  payload,
});

export interface ServiceEvent<T extends ServiceEventPayload> {
  meta?: {
    requestId?: string;
    timestamp?: number;
    uid?: string;
    sessionId?: string;
    route?: string;
  };
  payload: T;
}
export type ServiceEventPayload = {
  [key: string]: unknown;
  reqAction?: string;
};

export interface SocketSend<K extends keyof OutSocketMessageActionMap>
  extends ServiceEventPayload {
  uid: string;
  sessionId: string;
  pattern: K;
  msg: OutSocketMessage<K>;
}
export interface SocketBroadcast<K extends keyof OutSocketMessageActionMap>
  extends ServiceEventPayload {
  uids: string[];
  sessionIds: string[];
  pattern: string;
  msg: OutSocketMessage<K>;
}

export interface NotifyUser<T extends UserNotificationPayload>
  extends ServiceEventPayload {
  uid: string;
  notification: T;
}
export interface NotificationRead extends ServiceMessagePayload {
  uid: string;
  notificationId: string;
  systemRead?: boolean;
  sessionId?: string;
}
export interface MembershipCheck extends ServiceMessagePayload {
  uid: string;
  uuid: string;
}
export interface WorkspaceDeleteOwned extends ServiceMessagePayload {
  ownerUid: string;
}
export interface EnvOpenRequest extends ServiceMessagePayload {
  uuid: string;
  sessionId: string;
}
export interface EnvCloseRequest extends ServiceMessagePayload {
  uuid: string;
  sessionId: string;
}
export interface UserProfileRequest extends ServiceMessagePayload {
  uid: string;
}

export interface UserOnline extends ServiceEventPayload {
  uid: string;
}
export type UserOffline = UserOnline;

export interface HealthCheck extends ServiceEventPayload {}

export type InternalMessage<T> = { id: string; data: T };

export interface EnvAffinityRequest extends ServiceEventPayload {
  uid: string;
  sessionId: string;
  uuid: string;
}

export interface InterEnvFSOpen extends ServiceEventPayload {
  uuid: string;
  path: string;
  stat: StatDTO;
  correlationId?: string;
}
export interface InterEnvFSClose extends ServiceEventPayload {
  uuid: string;
  ino: number;
}
