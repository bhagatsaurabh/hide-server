export type MembersModifiedMessage = {
  uuid: string;
  added: string[];
  removed: string[];
};

export type WorkspaceDeletedMessage = {
  uuid: string;
  members: string[];
};
