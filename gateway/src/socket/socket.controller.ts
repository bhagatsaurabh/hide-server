import { Controller } from '@nestjs/common';
import { EventPattern, Transport } from '@nestjs/microservices';
import { ServiceEvent, SocketBroadcast, SocketSend } from 'hide-common';
import { SocketGateway } from './socket.gateway';

@Controller()
export class SocketController {
  constructor(private readonly socketGateway: SocketGateway) {}

  @EventPattern('socket.send', Transport.REDIS)
  async handleSendSocket(msg: ServiceEvent<SocketSend<any>>) {
    await this.socketGateway.send(msg.payload);
  }
  @EventPattern('socket.broadcast', Transport.REDIS)
  async handleSendBroadcast(msg: ServiceEvent<SocketBroadcast<any>>) {
    await this.socketGateway.broadcast(msg.payload);
  }

  @EventPattern('__keyevent@1__:expired', Transport.REDIS)
  async handleCacheExpiry(key: string) {
    await this.socketGateway.handleCacheExpiry(key);
  }
}
