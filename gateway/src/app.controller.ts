import { Controller } from '@nestjs/common';
import { SocketGateway } from './socket/socket.gateway';
import { EventPattern, Transport } from '@nestjs/microservices';
import { SocketMessage, SocketMessageType, NotificationMessage } from 'hide-common';

@Controller()
export class AppController {
  constructor(private readonly socketsGateway: SocketGateway) {}

  @EventPattern('socket.send', Transport.REDIS)
  async handleSendSocket(data: SocketMessage<any>) {
    await this.socketsGateway.send(data.uid, data);
  }

  @EventPattern('notification.send', Transport.RMQ)
  async handleSendNotification(data: NotificationMessage<any>) {
    await this.socketsGateway.send(data.uid, { data, uid: data.uid, type: SocketMessageType.NOTIFICATION });
  }
}
