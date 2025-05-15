import { OutSocketMessagePayload } from "./socket.message";

export type NotificationPayloadMap = {
  new: UserNotificationPayload;
  pending: UserNotificationPayload[];
};
export type NotificationPayload = {
  [K in keyof NotificationPayloadMap]: {
    action: K;
    payload: NotificationPayloadMap[K];
  };
}[keyof NotificationPayloadMap];

export type NotificationType =
  | "workspace-invite"
  | "workspace-membership-removed";

export interface UserNotificationPayload extends OutSocketMessagePayload {
  type: NotificationType;
  id: string;
}

export interface WorkspaceInvite extends UserNotificationPayload {
  inviterId: string;
  workspaceUUID: string;
  token: string;
}

export interface ExclusionData extends UserNotificationPayload {
  actorId: string;
  workspaceUUID: string;
}
