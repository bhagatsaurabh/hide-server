export enum NotificationType {
  WORKSPACE_INVITE = "WORKSPACE_INVITE",
  WORKSPACE_MEMBER_REMOVED = "WORKSPACE_MEMBER_REMOVED",
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

export type ExclusionData = {
  actorId: string;
  workspaceUUID: string;
};
