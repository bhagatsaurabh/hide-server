export type SocketMessage<T> = {
  uid: string;
  type: SocketMessageType;
  data: T;
};

export type SocketMessagePayload = {
  [k: string]: unknown;
  action: string;
};

export type SocketBroadcast<T extends SocketMessagePayload> = {
  uids: string[];
  type: SocketMessageType;
  data: T;
};

export enum SocketMessageType {
  NOTIFICATION = "notification",
  PENDING_NOTIFICATION = "pending-notifications",
  FILESYSTEM = "fs",
}
