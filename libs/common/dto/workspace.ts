export type StatDTO = {
  name: string;
  size: number;
  isDir: boolean;
  ino: number;
};

export enum WorkspaceStatus {
  PROVISIONING = "PROVISIONING",
  READY = "READY",
  DEPROVISIONING = "DEPROVISIONING",
  COLD = "COLD",
  DELETING = "DELETING",
}

export type WorkspaceWaitDTO = {
  wait: boolean;
};

export interface MembershipDTO {
  workspaceId: number;
  userId: string;
  role: "owner" | "member";
  joinedAt: string;
  name: string;
  username: string;
  picture: string;
}

export interface WorkspaceDTO {
  id: number;
  uuid: string;
  name: string;
  description: string;
  createdAt: string;
  memberships: MembershipDTO[];
  image: string;
  status: WorkspaceStatus;
}
