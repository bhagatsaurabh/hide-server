import { OutSocketMessagePayload } from "./socket.message";

export type NotificationPayloadMap = {
  new: UserNotificationPayload;
  pending: UserNotificationPayload[];
  directive: UserNotificationPayload;
};
export type NotificationPayload = {
  [K in keyof NotificationPayloadMap]: {
    action: K;
    payload: NotificationPayloadMap[K];
  };
}[keyof NotificationPayloadMap];

export type NotificationType =
  | "workspace-invite"
  | "workspace-membership-removed"
  | "workspace-access-code"
  | "workspace-downgraded"
  | "notification-delete";

export const persistentNtfnTypes: NotificationType[] = [
  "workspace-invite",
  "workspace-access-code",
];

export interface UserNotificationPayload extends OutSocketMessagePayload {
  type: NotificationType;
  id: string;
  createdOn: string | Date;
  actedOn?: number;
}

export interface WorkspaceInvite extends UserNotificationPayload {
  inviterId: string;
  workspaceUUID: string;
  token: string;
}

export interface WorkspaceDowngraded extends UserNotificationPayload {
  uuid: string;
}

export interface WorkspaceAccessRequest extends UserNotificationPayload {
  success: boolean;
  code: string;
  reqId: string;
}

export interface ExclusionData extends UserNotificationPayload {
  actorId: string;
  workspaceUUID: string;
  name: string;
}
