export type NotificationMessage = {
  uid: string;
  type: NotificationType;
  data: object;
};

export enum NotificationType {
  WORKSPACE_INVITE = "WORKSPACE_INVITE",
}
