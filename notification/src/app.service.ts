/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Firestore } from '@google-cloud/firestore';
import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { Cache } from '@nestjs/cache-manager';
import { NotificationMessage } from 'hide-common/message/notification.message';
import { FirestoreService } from 'hide-firebase';
import { RedisService } from 'hide-redis';
import { notificationConverter } from './utils/converter';
import { SocketMessage, SocketMessageType } from 'hide-common/message/socket.message';

@Injectable()
export class AppService {
  private db: Firestore;
  private cache: Cache;

  constructor(
    @Inject('NOTIFICATION_SERVICE') private client: ClientProxy,
    private readonly firestore: FirestoreService,
    private readonly redisService: RedisService,
  ) {
    this.db = this.firestore.db;
    this.cache = this.redisService.get();
  }

  async pushNotification(data: NotificationMessage<any>) {
    const presence = await this.cache.get<boolean>(`presence:${data.uid}`);
    if (!presence) {
      await this.db.collection('notifications').doc(data.uid).collection('messages').add(data);
    } else {
      this.client.emit<any, SocketMessage<NotificationMessage<any>>>('socket', {
        uid: data.uid,
        type: SocketMessageType.NOTIFICATION,
        data,
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
      this.client.emit<any, SocketMessage<NotificationMessage<any>>>('socket', {
        uid: ntfn.uid,
        type: SocketMessageType.NOTIFICATION,
        data: ntfn,
      });
    }
  }
}
