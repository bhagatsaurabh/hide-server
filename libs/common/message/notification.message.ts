export enum NotificationType {
  WORKSPACE_INVITE = "WORKSPACE_INVITE",
}

export type NotificationMessage<T> = {
  uid: string;
  type: NotificationType;
  data: T;
};

export type InvitationData = {
  inviterId: string;
  workspaceUUID: string;
  token: string;
};
