import { randomUUID } from "node:crypto";
import { UserNotificationPayload } from "./notification.message";
import { OutSocketMessage, OutSocketMessageActionMap } from "./socket.message";

export * from "./notification.message";
export * from "./socket.message";
export * from "./workspace.message";

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

export interface ServiceMessage<T extends ServiceMesagePayload> {
  meta: {
    requestId: string;
    timestamp: number;
    uid: string;
    route: string;
  };
  payload: T;
}
export type ServiceMesagePayload = {};

export const createMessage = <T extends ServiceMesagePayload>(
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
    route?: string;
  };
  payload: T;
}
export type ServiceEventPayload = {};

export interface SocketSend<K extends keyof OutSocketMessageActionMap>
  extends ServiceEventPayload {
  uid: string;
  pattern: string;
  msg: OutSocketMessage<K>;
}
export interface SocketBroadcast<K extends keyof OutSocketMessageActionMap>
  extends ServiceEventPayload {
  uids: string[];
  pattern: string;
  msg: OutSocketMessage<K>;
}

export interface NotifyUser<T extends UserNotificationPayload>
  extends ServiceEventPayload {
  uid: string;
  notification: T;
}
export interface NotificationRead extends ServiceMesagePayload {
  uid: string;
  notificationId: string;
}

export interface UserOnline extends ServiceEventPayload {
  uid: string;
}
export type UserOffline = UserOnline;

export interface EnvShutdown extends ServiceEventPayload {
  uid: string;
}
export interface EnvDeprovision extends ServiceEventPayload {
  uuid: string;
}
