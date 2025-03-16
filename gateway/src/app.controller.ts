import { Controller } from '@nestjs/common';
import { SocketGateway } from './socket/socket.gateway';
import { EventPattern } from '@nestjs/microservices';
import { SocketMessage } from 'hide-common/message/socket.message';

@Controller()
export class AppController {
  constructor(private readonly socketsGateway: SocketGateway) {}

  @EventPattern('socket')
  async handleSocketMessage(data: SocketMessage<any>) {
    await this.socketsGateway.send(data.uid, data);
  }
}
