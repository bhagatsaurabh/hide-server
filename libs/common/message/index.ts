import { randomUUID } from "node:crypto";
import { SocketMessagePayload } from "./socket.message";
import { UserNotificationPayload } from "./notification.message";

export * from "./notification.message";
export * from "./socket.message";
export * from "./filesystem.message";
export * from "./env.message";
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

export interface SocketSend<T extends SocketMessagePayload>
  extends ServiceEventPayload {
  uid: string;
  pattern: string;
  msg: T;
}

export interface SocketBroadcast<T extends SocketMessagePayload>
  extends ServiceEventPayload {
  uids: string[];
  pattern: string;
  msg: T;
}

export interface NotifyUser<T extends UserNotificationPayload>
  extends ServiceEventPayload {
  uid: string;
  notification: T;
}
