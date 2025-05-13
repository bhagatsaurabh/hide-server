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

export interface Message<T = any> {
  meta: {
    requestId: string;
    timestamp: number;
    uid: string;
    route: string;
  };
  payload: T;
}
