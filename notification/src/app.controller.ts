import { Body, Controller, HttpCode, HttpStatus, Post, OnModuleInit, Get } from '@nestjs/common';
import { EventPattern, MessagePattern, Payload, Transport } from '@nestjs/microservices';
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
export class AppController implements OnModuleInit {
  constructor(private readonly appService: AppService) {}

  onModuleInit() {}

  @MessagePattern('notification.send', Transport.RMQ)
  async handleNotification(@Payload() msg: ServiceMessage<NotifyUser<UserNotificationPayload>>) {
    await this.appService.pushNotification(msg);
  }

  @EventPattern('user.online', Transport.REDIS)
  async handleUserOnline(uid: string) {
    await this.appService.pushAllPendingNotifications(uid);
  }

  @MessagePattern('notification.read', Transport.RMQ)
  async handleReadNotification(msg: ServiceMessage<NotificationRead>) {
    console.log('Received rmq event: ', msg);
    await this.appService.handleReadNotification(msg.payload.uid, msg.payload.notificationId, false, true);
  }

  @Get('all')
  async getAllNotifications(@UserHeader() user: User) {
    return await this.appService.getAllNotifications(user.uid);
  }

  @Post('read')
  @HttpCode(HttpStatus.NO_CONTENT)
  async readNotification(@UserHeader() user: User, @Body() data: NotificationReadDTO) {
    await this.appService.handleReadNotification(user.uid, data.id);
  }
}
