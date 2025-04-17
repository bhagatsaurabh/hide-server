import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { DefaultEventsMap, Server, Socket } from 'socket.io';
import { Cache } from '@nestjs/cache-manager';
import { RedisService } from 'hide-redis';
import { User } from 'hide-common/dto/user';
import { ClientProxy } from '@nestjs/microservices';
import { SocketMessage } from 'hide-common/message/socket.message';
import { Client as SSHClient } from 'ssh2';
import { SocketData, SSHClose, SSHCloseAll, SSHData, SSHRequest } from 'src/utils/types';
import { EventsMap } from 'socket.io/dist/typed-events';
import { randomUUID } from 'node:crypto';

type SocketWithData = Socket<DefaultEventsMap, EventsMap, DefaultEventsMap, SocketData>;

@WebSocketGateway({
  cors: { origin: process.env.CORS_ORIGIN! },
})
@Injectable()
export class SocketGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  private server: Server;

  private cache: Cache;
  constructor(
    @Inject('GATEWAY_SERVICE') private client: ClientProxy,
    private readonly redisService: RedisService,
  ) {
    this.cache = this.redisService.get();
  }

  async handleConnection(@ConnectedSocket() socket: SocketWithData) {
    const token = socket.handshake.auth?.token as string;
    if (!token) {
      return socket.disconnect();
    }
    const user = await this.handleAuthentication(token);
    if (!user) {
      return socket.disconnect();
    }
    socket.data.user = user;
    socket.data.ssh = {};
    await this.cache.set<string>(`presence:${user.uid}`, socket.id);
    this.client.emit('user-online', user.uid);
  }
  async handleDisconnect(@ConnectedSocket() socket: Socket) {
    const uid = (socket.data as SocketData).user.uid;
    this.client.emit('user-offline', uid);
    await this.cache.del(`presence:${uid}`);
  }
  async handleAuthentication(token: string) {
    try {
      const response = await fetch(`http://auth/api/validate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        throw new UnauthorizedException('Invalid token');
      }
      return (await response.json()) as User;
    } catch (error) {
      console.log(error);
      return null;
    }
  }
  async checkMembership(user, workspaceUUID) {
    try {
      const response = await fetch(`http://workspace/api/${workspaceUUID}/check-membership`, {
        method: 'GET',
        headers: {
          'x-auth-user': Buffer.from(JSON.stringify(user)).toString('base64'),
        },
      });
      if (!response.ok) {
        return false;
      }
      return true;
    } catch (error) {
      console.log(error);
    }
    return false;
  }

  @SubscribeMessage('ssh:request')
  async handleSSHRequest(@MessageBody() data: SSHRequest, @ConnectedSocket() client: SocketWithData) {
    const user = client.data.user;
    if (!(await this.checkMembership(user, data.workspaceUUID))) {
      client.emit('ssh:error', { message: 'Permission denied' });
      return;
    }

    this.handleSSHConnection(data.privateKey, data.workspaceUUID, client);
  }

  @SubscribeMessage('ssh:data')
  handleSSHData(@MessageBody() data: SSHData, @ConnectedSocket() client: SocketWithData) {
    const stream = client.data.ssh?.[data.workspaceUUID]?.sessions?.[data.sessionId];
    if (stream) {
      stream.write(data.input);
    }
  }

  @SubscribeMessage('ssh:close')
  handleSSHClose(@MessageBody() data: SSHClose, @ConnectedSocket() client: SocketWithData) {
    console.log(`Closing session ${data.sessionId}`);
    client.data.ssh?.[data.workspaceUUID]?.sessions?.[data.sessionId]?.close();
  }

  @SubscribeMessage('ssh:closeall')
  handleSSHCloseAll(@MessageBody() data: SSHCloseAll, @ConnectedSocket() client: SocketWithData) {
    for (const sessionId in client.data.ssh?.[data.workspaceUUID]?.sessions) {
      client.data.ssh?.[data.workspaceUUID]?.sessions?.[sessionId]?.close();
    }
    client.data.ssh?.[data.workspaceUUID]?.conn?.end();
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
      client.emit('ssh:error', { message: 'SSH connection failed' });
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
        client.emit('ssh:error', { message: 'Failed to start shell' });
        return;
      }
      client.data.ssh[workspaceUUID].sessions[sessionId] = stream;
      client.emit('ssh:open', sessionId);

      stream.on('data', (data: Buffer) => {
        client.emit('ssh:output', { sessionId, output: data.toString() });
      });
      stream.on('close', () => {
        client.emit('ssh:closed', { sessionId });
      });
    });
  }
  async send(uid: string, data: SocketMessage<any>) {
    const socketId = await this.cache.get<string>(`presence:${uid}`);
    if (socketId) {
      this.server.to(socketId).emit(data.type, data);
    }
  }
}
