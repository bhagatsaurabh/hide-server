import { OutSocketMessagePayload } from "./socket.message";

export type MembersModified = {
  uuid: string;
  added: string[];
  removed: string[];
};

export type WorkspaceDeleted = {
  uuid: string;
  members: string[];
};

export interface WorkspaceMembersModified extends OutSocketMessagePayload {
  uuid: string;
}

export type WorkspaceResponseMap = {
  "members.modified": WorkspaceMembersModified;
};
export type WorkspacePayload = {
  [K in keyof WorkspaceResponseMap]: {
    action: K;
    payload: WorkspaceResponseMap[K];
  };
}[keyof WorkspaceResponseMap];
