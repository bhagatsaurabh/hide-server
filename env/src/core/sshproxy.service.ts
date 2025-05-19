import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Client, ClientChannel, Client as SSHClient } from 'ssh2';
import { ServiceEvent, SocketSend } from 'hide-common';
import { SSHClose, SSHCloseAll, SSHData, SSHRequest } from 'hide-common/message/ssh.message';
import { ClientProxy } from '@nestjs/microservices';

type ActiveSSHSessions = Record<string, { conn: Client; sessions: Record<string, ClientChannel> }>;
type ActiveWorkspaces = Record<string, ActiveSSHSessions>;

@Injectable()
export class SSHProxyService {
  conns: ActiveWorkspaces;

  constructor(@Inject('ENV_SERVICE_REDIS') private readonly redis: ClientProxy) {}

  handleRequest(uid: string, msg: SSHRequest) {
    this.handleSSHConnection(uid, msg);
  }
  handleSSHConnection(uid: string, msg: SSHRequest) {
    if (!this.conns[uid]) {
      this.conns[uid] = {};
    }

    if (!this.conns[uid][msg.uuid]) {
      this.handleNewSSHConnection(uid, msg);
    } else {
      this.handleNewSSHSession(uid, msg);
    }
  }
  handleNewSSHConnection(uid: string, msg: SSHRequest) {
    const conn = new SSHClient();
    conn.on('ready', () => {
      this.conns[uid][msg.uuid] = { conn, sessions: {} };
      this.handleNewSSHSession(uid, msg);
    });
    conn.on('error', (_err) => {
      this.redis.emit<any, ServiceEvent<SocketSend<'ssh'>>>('socket.send', {
        payload: {
          uid,
          pattern: 'ssh',
          msg: { action: 'error', payload: { message: 'SSH connection failed' } },
        },
      });
    });
    conn.on('close', () => {
      if (this.conns[uid] && this.conns[uid][msg.uuid]) {
        delete this.conns[uid][msg.uuid];
      }
    });

    if (process.env.NODE_ENV === 'development' && process.env.HIDE_ENV_ON_K8s) {
      conn.connect({
        host: 'host.docker.internal',
        port: 2222,
        username: 'devuser',
        privateKey: msg.privateKey,
      });
    } else {
      conn.connect({
        host: `workspace-${msg.uuid}`,
        port: 22,
        username: 'devuser',
        privateKey: msg.privateKey,
      });
    }
  }
  handleNewSSHSession(uid: string, msg: SSHRequest) {
    const conn = this.conns[uid][msg.uuid].conn;
    const sessionId = randomUUID();

    conn.shell((err, channel) => {
      if (err) {
        this.redis.emit<any, ServiceEvent<SocketSend<'ssh'>>>('socket.send', {
          payload: {
            uid,
            pattern: 'ssh',
            msg: { action: 'error', payload: { message: 'Failed to start shell' } },
          },
        });
        return;
      }
      this.conns[uid][msg.uuid].sessions[sessionId] = channel;
      this.redis.emit<any, ServiceEvent<SocketSend<'ssh'>>>('socket.send', {
        payload: {
          uid,
          pattern: 'ssh',
          msg: { action: 'open', payload: { sessionId } },
        },
      });

      channel.on('data', (data: Buffer) => {
        this.redis.emit<any, ServiceEvent<SocketSend<'ssh'>>>('socket.send', {
          payload: {
            uid,
            pattern: 'ssh',
            msg: { action: 'output', payload: { sessionId, output: data.toString() } },
          },
        });
      });
      channel.on('close', () => {
        this.redis.emit<any, ServiceEvent<SocketSend<'ssh'>>>('socket.send', {
          payload: {
            uid,
            pattern: 'ssh',
            msg: { action: 'closed', payload: { sessionId } },
          },
        });
      });
    });
  }

  handleSSHData(uid: string, msg: SSHData) {
    const stream = this.conns[uid]?.[msg.uuid].sessions?.[msg.sessionId];
    if (stream) {
      stream.write(msg.input);
    }
  }
  handleSSHClose(uid: string, msg: SSHClose) {
    this.conns[uid]?.[msg.uuid].sessions?.[msg.sessionId]?.close();
  }

  handleSSHCloseAll(uid: string, msg: SSHCloseAll) {
    for (const sessionId in this.conns[uid][msg.uuid]?.sessions || {}) {
      this.conns[uid][msg.uuid].sessions?.[sessionId]?.close();
    }
    this.conns[uid]?.[msg.uuid].conn?.end();
  }
}
