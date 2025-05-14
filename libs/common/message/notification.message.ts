import { SocketMessagePayload } from "./socket.message";

export type NotificationType =
  | "workspace-invite"
  | "workspace-membership-removed";

export interface UserNotificationPayload extends SocketMessagePayload {
  action: NotificationType;
  [key: string]: unknown;
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
