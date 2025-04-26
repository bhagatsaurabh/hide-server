import { Controller } from '@nestjs/common';
import { EventPattern, Transport } from '@nestjs/microservices';
import { NotificationMessage } from 'hide-common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @EventPattern('notify', Transport.RMQ)
  async handleNotification(data: NotificationMessage<any>) {
    await this.appService.pushNotification(data);
  }

  @EventPattern('user-online', Transport.REDIS)
  async handleUserOnline(uid: string) {
    await this.appService.pushAllPendingNotifications(uid);
  }
}
