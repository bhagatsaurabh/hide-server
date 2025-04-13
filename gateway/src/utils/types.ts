import { Client, ClientChannel } from 'ssh2';
import { User } from 'hide-common/dto/user';

export type SocketData = {
  user: User;
  ssh: Record<string, { conn: Client; sessions: Record<string, ClientChannel> }>;
};

export type SSHRequest = {
  privateKey: string;
  workspaceUUID: string;
};

export type SSHData = {
  workspaceUUID: string;
  sessionId: string;
  input: string;
};

export type SSHClose = {
  workspaceUUID: string;
  sessionId: string;
};

export type SSHCloseAll = {
  workspaceUUID: string;
};
