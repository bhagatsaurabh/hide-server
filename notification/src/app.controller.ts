import { Controller } from '@nestjs/common';
import { EventPattern } from '@nestjs/microservices';
import { NotificationMessage } from 'hide-common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @EventPattern('notify')
  async handleNotification(data: NotificationMessage<any>) {
    await this.appService.pushNotification(data);
  }

  @EventPattern('user-online')
  async handleUserOnline(uid: string) {
    await this.appService.pushAllPendingNotifications(uid);
  }
}
