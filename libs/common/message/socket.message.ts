export type SocketMessage<T> = {
  uid: string;
  type: SocketMessageType;
  data: T;
};

export enum SocketMessageType {
  NOTIFICATION = "notification",
  PENDING_NOTIFICATION = "pending-notifications",
}
