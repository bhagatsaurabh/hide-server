import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Client as SSHClient } from 'ssh2';
import { InSocketMessage } from 'hide-common';
import { SSHClose, SSHCloseAll, SSHData, SSHRequest } from 'hide-common/message/ssh.message';
import { SocketWithData } from './socket.gateway';
import { CommonService } from './common.service';

@Injectable()
export class SSHProxyService {
  constructor(private readonly service: CommonService) {}

  async handleSSHProxyMessage(msg: InSocketMessage<'env', any>, client: SocketWithData) {
    switch (msg.action) {
      case 'ssh.request': {
        await this.handleSSHRequest(msg, client);
        break;
      }
      case 'ssh.data': {
        this.handleSSHData(msg, client);
        break;
      }
      case 'ssh.close': {
        this.handleSSHClose(msg, client);
        break;
      }
    }
  }

  async handleSSHRequest(msg: InSocketMessage<'env', SSHRequest>, client: SocketWithData) {
    const user = client.data.user;
    if (!(await this.service.checkMembership(user, msg.payload.uuid))) {
      client.emit('ssh', { action: 'error', payload: { message: 'Permission denied' } });
      return;
    }

    this.handleSSHConnection(msg.payload.privateKey, msg.payload.uuid, client);
  }
  handleSSHData(msg: InSocketMessage<'env', SSHData>, client: SocketWithData) {
    const stream = client.data.ssh?.[msg.payload.uuid]?.sessions?.[msg.payload.sessionId];
    if (stream) {
      stream.write(msg.payload.input);
    }
  }
  handleSSHClose(msg: InSocketMessage<'env', SSHClose>, client: SocketWithData) {
    client.data.ssh?.[msg.payload.uuid]?.sessions?.[msg.payload.sessionId]?.close();
  }
  handleSSHCloseAll(msg: InSocketMessage<'env', SSHCloseAll>, client: SocketWithData) {
    for (const sessionId in client.data.ssh?.[msg.payload.uuid]?.sessions) {
      client.data.ssh?.[msg.payload.uuid]?.sessions?.[sessionId]?.close();
    }
    client.data.ssh?.[msg.payload.uuid]?.conn?.end();
  }

  handleSSHConnection(privateKey: string, workspaceUUID: string, client: SocketWithData) {
    if (!client.data?.ssh?.[workspaceUUID]) {
      this.handleNewSSHConnection(privateKey, workspaceUUID, client);
    } else {
      this.handleNewSSHSession(workspaceUUID, client);
    }
  }
  handleNewSSHConnection(privateKey: string, workspaceUUID: string, client: SocketWithData) {
    const conn = new SSHClient();
    conn.on('ready', () => {
      client.data.ssh[workspaceUUID] = { conn, sessions: {} };
      this.handleNewSSHSession(workspaceUUID, client);
    });
    conn.on('error', (err) => {
      console.error(`SSH Conn Error for ${workspaceUUID}:`, err);
      client.emit('ssh', { action: 'error', payload: { message: 'SSH connection failed' } });
    });
    conn.on('close', () => {
      delete client.data.ssh[workspaceUUID];
    });

    if (process.env.NODE_ENV === 'development' && process.env.HIDE_ENV_ON_K8s) {
      conn.connect({
        host: 'host.docker.internal',
        port: 2222,
        username: 'devuser',
        privateKey,
      });
    } else {
      conn.connect({
        host: `workspace-${workspaceUUID}`,
        port: 22,
        username: 'devuser',
        privateKey,
      });
    }
  }
  handleNewSSHSession(workspaceUUID: string, client: SocketWithData) {
    const conn = client.data.ssh[workspaceUUID].conn;
    const sessionId = randomUUID();

    conn.shell((err, stream) => {
      if (err) {
        console.log(err);
        client.emit('ssh', { action: 'error', payload: { message: 'Failed to start shell' } });
        return;
      }
      client.data.ssh[workspaceUUID].sessions[sessionId] = stream;
      client.emit('ssh', { action: 'open', payload: { sessionId } });

      stream.on('data', (data: Buffer) => {
        client.emit('ssh', { action: 'output', payload: { sessionId, output: data.toString() } });
      });
      stream.on('close', () => {
        client.emit('ssh', { action: 'closed', payload: { sessionId } });
      });
    });
  }
}
