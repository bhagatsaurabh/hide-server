import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { EventPattern, MessagePattern, Transport } from '@nestjs/microservices';
import { AppService } from './app.service';
import {
  NotificationRead,
  NotifyUser,
  ServiceMessage,
  UserHeader,
  UserNotificationPayload,
} from 'hide-common';
import { User } from 'hide-common/model/user';
import { NotificationReadDTO } from './common/dto';

@Controller('api')
export class AppController {
  constructor(private readonly appService: AppService) {}

  @MessagePattern('notification.send', Transport.RMQ)
  async handleNotification(data: ServiceMessage<NotifyUser<UserNotificationPayload>>) {
    await this.appService.pushNotification(data);
  }

  @EventPattern('user.online', Transport.REDIS)
  async handleUserOnline(uid: string) {
    await this.appService.pushAllPendingNotifications(uid);
  }

  @MessagePattern('notification.read', Transport.RMQ)
  async handleReadNotification(msg: ServiceMessage<NotificationRead>) {
    await this.appService.handleReadNotification(msg.payload.uid, { id: msg.payload.notificationId }, false);
  }

  @Post('read')
  @HttpCode(HttpStatus.NO_CONTENT)
  async readNotification(@UserHeader() user: User, @Body() data: NotificationReadDTO) {
    await this.appService.handleReadNotification(user.uid, data);
  }
}
