import { User } from 'hide-common/dto/user';

export type SocketData = {
  user: User;
};

export type SSHRequest = {
  privateKey: string;
  workspaceUUID: string;
};
