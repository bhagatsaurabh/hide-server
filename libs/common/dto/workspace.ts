export type StatDTO = {
  name: string;
  size: number;
  isDir: boolean;
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
