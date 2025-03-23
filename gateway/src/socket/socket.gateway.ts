import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import {
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Cache } from '@nestjs/cache-manager';
import { RedisService } from 'hide-redis';
import { User } from 'hide-common/dto/user';
import { SocketData } from 'src/utils/types';
import { ClientProxy } from '@nestjs/microservices';
import { SocketMessage } from 'hide-common/message/socket.message';

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
    (socket.data as SocketData).uid = user.uid;
    await this.cache.set<string>(`presence:${user.uid}`, socket.id);
    this.client.emit('user-online', user.uid);
  }
  async handleDisconnect(@ConnectedSocket() socket: Socket) {
    const uid = (socket.data as SocketData).uid;
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

  async send(uid: string, data: SocketMessage<any>) {
    const socketId = await this.cache.get<string>(`presence:${uid}`);
    if (socketId) {
      this.server.to(socketId).emit(data.type, data);
    }
  }
}
