export type InviteDTO = {
  inviteeId: string;
  workspaceUUID: string;
  sshKey: string;
};

export type InviteAllDTO = {
  inviteeIds: string[];
  workspaceUUID: string;
  sshKey: string;
};
