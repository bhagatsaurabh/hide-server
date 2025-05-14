import { Firestore } from '@google-cloud/firestore';
import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { Cache } from '@nestjs/cache-manager';
import { NotifyUser, ServiceEvent, ServiceMessage, SocketSend, UserNotificationPayload } from 'hide-common';
import { FirestoreService } from 'hide-firebase';
import { RedisService } from 'hide-redis';
import { notificationConverter } from './utils/converter';

@Injectable()
export class AppService {
  private db: Firestore;
  private cache: Cache;

  constructor(
    @Inject('NOTIFICATION_SERVICE_RMQ') private rmq: ClientProxy,
    @Inject('NOTIFICATION_SERVICE_REDIS') private redis: ClientProxy,
    private readonly firestore: FirestoreService,
    private readonly redisService: RedisService,
  ) {
    this.db = this.firestore.db;
    this.cache = this.redisService.get();
  }

  async pushNotification(data: ServiceMessage<NotifyUser<UserNotificationPayload>>) {
    const presence = await this.cache.get<boolean>(`presence:${data.payload.uid}`);
    if (!presence) {
      await this.db
        .collection('notifications')
        .doc(data.payload.uid)
        .collection('messages')
        .add(data.payload.notification);
    } else {
      this.redis.send<any, ServiceEvent<SocketSend<UserNotificationPayload>>>('socket.send', {
        payload: { pattern: 'notification', uid: data.payload.uid, msg: data.payload.notification },
      });
    }
  }

  async pushAllPendingNotifications(uid: string) {
    const snap = await this.db
      .collection('notifications')
      .doc(uid)
      .collection('messages')
      .withConverter(notificationConverter)
      .get();

    const pendingNtfns = snap.docs.map((doc) => doc.data());
    for (const ntfn of pendingNtfns) {
      this.redis.send<any, ServiceEvent<SocketSend<any>>>('socket.send', {
        payload: { pattern: 'notification', uid, msg: ntfn },
      });
    }
  }
}
