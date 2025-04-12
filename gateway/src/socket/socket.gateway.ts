/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
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
import { Server, Socket } from 'socket.io';
import { Cache } from '@nestjs/cache-manager';
import { RedisService } from 'hide-redis';
import { User } from 'hide-common/dto/user';
import { ClientProxy } from '@nestjs/microservices';
import { SocketMessage } from 'hide-common/message/socket.message';
import { Client as SSHClient } from 'ssh2';
import { SocketData, SSHRequest } from 'src/utils/types';

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

  async handleConnection(@ConnectedSocket() socket: Socket) {
    const token = socket.handshake.auth?.token as string;
    if (!token) {
      return socket.disconnect();
    }
    const user = await this.handleAuthentication(token);
    if (!user) {
      return socket.disconnect();
    }
    (socket.data as SocketData).user = user;
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
  async handleSSHRequest(@MessageBody() data: SSHRequest, @ConnectedSocket() client: Socket) {
    const user = (client.data as SocketData).user;
    if (!(await this.checkMembership(user, data.workspaceUUID))) {
      client.emit('ssh:error', { message: 'Permission denied' });
      return;
    }

    this.handleSSHConnection(data.privateKey, data.workspaceUUID, client);
  }

  handleSSHConnection(privateKey: string, workspaceUUID: string, client: Socket) {
    const conn = new SSHClient();

    conn.on('ready', () => {
      console.log(`SSH Connected for ${workspaceUUID}`);
      conn.shell((err, stream) => {
        if (err) {
          console.log(err);
          client.emit('ssh:error', 'Failed to start shell');
          return;
        }
        client.on('ssh:data', (msg) => void stream.write(msg));
        stream.on('data', (data) => client.emit('ssh:output', data.toString()));
        stream.on('close', () => {
          client.emit('ssh:closed');
          conn.end();
        });
      });
    });

    conn.on('error', (err) => {
      console.error(`SSH Error for ${workspaceUUID}:`, err);
      client.emit('ssh:error', 'SSH connection failed');
    });

    conn.connect({
      host: 'host.docker.internal' /* `workspace-${workspaceUUID}` */,
      port: 2222 /* 22 */,
      username: 'devuser',
      privateKey,
    });
  }

  async send(uid: string, data: SocketMessage<any>) {
    const socketId = await this.cache.get<string>(`presence:${uid}`);
    if (socketId) {
      this.server.to(socketId).emit(data.type, data);
    }
  }
}
