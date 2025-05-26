import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Client, ClientChannel, Client as SSHClient } from 'ssh2';
import { CachedWorkspace, ServiceEvent, SocketSend } from 'hide-common';
import { SSHClose, SSHCloseAll, SSHData, SSHRequest } from 'hide-common/message/ssh.message';
import { ClientProxy } from '@nestjs/microservices';
import { RedisService } from 'hide-redis';
import { Cache } from '@nestjs/cache-manager';
import { CommonRef } from 'src/common/refs/common.ref';

type ActiveSSHSessions = Record<
  string,
  { conn: Client; sessionId: string; sessions: Record<string, ClientChannel> }
>;
type ActiveWorkspaces = Record<string, ActiveSSHSessions>;

@Injectable()
export class SSHProxyService {
  cache: Cache;
  conns: ActiveWorkspaces;
  instanceId: string;

  constructor(
    @Inject('ENV_SERVICE_REDIS') private readonly redis: ClientProxy,
    private readonly cacheService: RedisService,
  ) {
    this.cache = this.cacheService.get();
    this.instanceId = CommonRef.getInstanceId();
  }

  handleRequest(uid: string, sessionId: string, msg: SSHRequest) {
    this.handleSSHConnection(uid, sessionId, msg);
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
      void this.updateConnCache(sessionId, msg.uuid, true);
      this.handleNewSSHSession(uid, sessionId, msg);
    });
    conn.on('error', (_err) => {
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
      void this.updateConnCache(sessionId, msg.uuid, false);
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
    const sshSessionId = randomUUID();

    conn.shell((err, channel) => {
      if (err) {
        this.redis.emit<any, ServiceEvent<SocketSend<'ssh'>>>('socket.send', {
          payload: {
            uid,
            sessionId,
            pattern: 'ssh',
            msg: { action: 'error', payload: { message: 'Failed to start shell' } },
          },
        });
        return;
      }
      this.conns[uid][msg.uuid].sessions[sshSessionId] = channel;
      this.redis.emit<any, ServiceEvent<SocketSend<'ssh'>>>('socket.send', {
        payload: {
          uid,
          sessionId,
          pattern: 'ssh',
          msg: { action: 'open', payload: { sshSessionId } },
        },
      });

      channel.on('data', (data: Buffer) => {
        this.redis.emit<any, ServiceEvent<SocketSend<'ssh'>>>('socket.send', {
          payload: {
            uid,
            sessionId,
            pattern: 'ssh',
            msg: { action: 'output', payload: { sshSessionId, output: data.toString() } },
          },
        });
      });
      channel.on('close', () => {
        this.redis.emit<any, ServiceEvent<SocketSend<'ssh'>>>('socket.send', {
          payload: {
            uid,
            sessionId,
            pattern: 'ssh',
            msg: { action: 'closed', payload: { sshSessionId } },
          },
        });
      });
    });
  }

  handleSSHData(uid: string, _sessionId: string, msg: SSHData) {
    const channel = this.conns[uid]?.[msg.uuid].sessions?.[msg.sshSessionId];
    if (channel) {
      channel.write(msg.input);
    }
  }
  async handleSSHClose(uid: string, sessionId: string, msg: SSHClose) {
    this.conns[uid]?.[msg.uuid].sessions?.[msg.sshSessionId]?.close();
    if (Object.keys(this.conns[uid]?.[msg.uuid].sessions || {}).length === 0) {
      await this.updateConnCache(sessionId, msg.uuid, false);
    }
  }

  async handleSSHCloseAll(uid: string, sessionId: string, msg: SSHCloseAll) {
    for (const sshSessionId in this.conns[uid][msg.uuid]?.sessions || {}) {
      this.conns[uid][msg.uuid].sessions?.[sshSessionId]?.close();
    }
    this.conns[uid]?.[msg.uuid].conn?.end();
    await this.updateConnCache(sessionId, msg.uuid, false);
  }

  async updateConnCache(sessionId: string, wsUuid: string, add: boolean) {
    const workspace = await this.cache.get<CachedWorkspace>(`workspace:${wsUuid}`);
    if (!workspace) return;

    if (add) {
      workspace.sshs[sessionId] = this.instanceId;
    } else {
      delete workspace.sshs[sessionId];
    }
    await this.cache.set<CachedWorkspace>(`workspace:${wsUuid}`, workspace);
  }
}
