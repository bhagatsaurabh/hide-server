import { WorkspaceStatus } from 'hide-common';

export type UpdateDTO = {
  id: number;
  name: string;
  description: string;
  members: string[];
};
export type UpdateStatusDTO = {
  uuid: string;
  status: WorkspaceStatus;
};
