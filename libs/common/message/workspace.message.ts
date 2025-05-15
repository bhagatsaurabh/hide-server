export type MembersModified = {
  uuid: string;
  added: string[];
  removed: string[];
};

export type WorkspaceDeleted = {
  uuid: string;
  members: string[];
};
