import { Controller } from '@nestjs/common';
import { EventPattern, Transport } from '@nestjs/microservices';
import { AppService } from './app.service';
import { NotifyUser, ServiceMessage, UserNotificationPayload } from 'hide-common';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @EventPattern('notification.send', Transport.RMQ)
  async handleNotification(data: ServiceMessage<NotifyUser<UserNotificationPayload>>) {
    await this.appService.pushNotification(data);
  }

  @EventPattern('user-online', Transport.REDIS)
  async handleUserOnline(uid: string) {
    await this.appService.pushAllPendingNotifications(uid);
  }
}
