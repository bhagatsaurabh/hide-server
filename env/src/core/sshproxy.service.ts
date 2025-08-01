import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Client, ClientChannel, Client as SSHClient } from 'ssh2';
import { CachedWorkspace, ServiceEvent, SocketSend } from 'hide-common';
import { SSHClose, SSHData, SSHRequest } from 'hide-common/message/ssh.message';
import { ClientProxy } from '@nestjs/microservices';
import { RedisService } from 'hide-redis';
import { Cache } from '@nestjs/cache-manager';
import { CommonRef } from 'src/common/refs/common.ref';

// wsUuid
type ActiveSSHSessions = Record<
  string,
  { conn: Client; sessionId: string; sessions: Record<string, ClientChannel> }
>;
// uid
type ActiveWorkspaces = Record<string, ActiveSSHSessions>;

@Injectable()
export class SSHProxyService {
  cache: Cache;
  conns: ActiveWorkspaces;

  constructor(
    @Inject('ENV_SERVICE_REDIS') private readonly redis: ClientProxy,
    private readonly cacheService: RedisService,
  ) {
    this.cache = this.cacheService.get();
    this.conns = {};
  }

  handleSSHConnection(uid: string, sessionId: string, msg: SSHRequest) {
    if (!this.conns[uid]) {
      this.conns[uid] = {};
    }

    if (!this.conns[uid][msg.uuid]) {
      this.handleNewSSHConnection(uid, sessionId, msg);
    } else {
      this.handleNewSSHSession(uid, sessionId, msg);
    }
  }
  handleNewSSHConnection(uid: string, sessionId: string, msg: SSHRequest) {
    const conn = new SSHClient();
    conn.on('ready', () => {
      this.conns[uid][msg.uuid] = { conn, sessionId, sessions: {} };
      void this.updateConnCache(sessionId, msg.uuid, { uid, msg });
    });
    conn.on('error', (err) => {
      console.log(err);
      this.redis.emit<any, ServiceEvent<SocketSend<'ssh'>>>('socket.send', {
        payload: {
          uid,
          sessionId,
          pattern: 'ssh',
          msg: { action: 'error', payload: { message: 'SSH connection failed' } },
        },
      });
    });
    conn.on('close', () => {
      if (this.conns[uid] && this.conns[uid][msg.uuid]) {
        delete this.conns[uid][msg.uuid];
      }
      void this.updateConnCache(sessionId, msg.uuid);
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
  handleNewSSHSession(uid: string, sessionId: string, msg: SSHRequest) {
    const conn = this.conns[uid][msg.uuid].conn;

    conn.shell({ term: 'xterm' }, (err, stream) => {
      if (err) {
        this.redis.emit<any, ServiceEvent<SocketSend<'ssh'>>>('socket.send', {
          payload: {
            uid,
            sessionId,
            pattern: 'ssh',
            msg: { action: 'error', payload: { message: 'Failed to start shell' } },
          },
        });
        throw err;
      }
      const sshSessionId = randomUUID();
      this.conns[uid][msg.uuid].sessions[sshSessionId] = stream;

      stream.on('data', (data: Buffer) => {
        this.redis.emit<any, ServiceEvent<SocketSend<'ssh'>>>('socket.send', {
          payload: {
            uid,
            sessionId,
            pattern: 'ssh',
            msg: { action: 'output', payload: { sshSessionId, output: data.toString() } },
          },
        });
      });
      stream.on('close', () => {
        this.redis.emit<any, ServiceEvent<SocketSend<'ssh'>>>('socket.send', {
          payload: {
            uid,
            sessionId,
            pattern: 'ssh',
            msg: { action: 'closed', payload: { sshSessionId } },
          },
        });
      });

      this.redis.emit<any, ServiceEvent<SocketSend<'ssh'>>>('socket.send', {
        payload: {
          uid,
          sessionId,
          pattern: 'ssh',
          msg: { action: 'open', payload: { sshSessionId, clientId: msg.clientId } },
        },
      });
    });
  }

  handleSSHData(uid: string, _sessionId: string, msg: SSHData) {
    const stream = this.conns[uid]?.[msg.uuid].sessions?.[msg.sshSessionId];
    if (stream) {
      stream.write(msg.input);
    }
  }
  async handleSSHClose(uid: string, sessionId: string, msg: SSHClose) {
    if (msg.sshSessionId === '#all') {
      for (const sshSessionId in this.conns[uid]?.[msg.uuid]?.sessions ?? {}) {
        this.conns[uid][msg.uuid].sessions?.[sshSessionId]?.close();
      }
      this.conns[uid]?.[msg.uuid]?.conn?.end();
      await this.updateConnCache(sessionId, msg.uuid);
      return;
    }

    this.conns[uid]?.[msg.uuid].sessions?.[msg.sshSessionId]?.close();
    if (Object.keys(this.conns[uid]?.[msg.uuid].sessions || {}).length === 0) {
      await this.updateConnCache(sessionId, msg.uuid);
    }
  }

  async updateConnCache(sessionId: string, wsUuid: string, add?: { uid: string; msg: SSHRequest }) {
    const workspace = await this.cache.get<CachedWorkspace>(`workspace:${wsUuid}`);
    if (!workspace) return;

    if (add) {
      workspace.sshs[sessionId] = CommonRef.getInstanceId();
    } else {
      delete workspace.sshs[sessionId];
    }
    await this.cache.set<CachedWorkspace>(`workspace:${wsUuid}`, workspace);

    if (add) {
      this.handleNewSSHSession(add.uid, sessionId, add.msg);
    }
  }
}
