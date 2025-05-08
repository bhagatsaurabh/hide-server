import { Controller } from '@nestjs/common';
import { SocketGateway } from './socket/socket.gateway';
import { EventPattern, Transport } from '@nestjs/microservices';
import { SocketMessage, SocketMessageType, NotificationMessage, SocketBroadcast } from 'hide-common';

@Controller()
export class AppController {
  constructor(private readonly socketsGateway: SocketGateway) {}

  @EventPattern('socket.send', Transport.REDIS)
  async handleSendSocket(msg: SocketMessage<any>) {
    await this.socketsGateway.send(msg.uid, msg);
  }
  @EventPattern('socket.broadcast', Transport.REDIS)
  async handleSendBroadcast(msg: SocketBroadcast<any>) {
    await this.socketsGateway.broadcast(msg);
  }

  @EventPattern('notification.send', Transport.RMQ)
  async handleSendNotification(data: NotificationMessage<any>) {
    await this.socketsGateway.send(data.uid, { data, uid: data.uid, type: SocketMessageType.NOTIFICATION });
  }
}
