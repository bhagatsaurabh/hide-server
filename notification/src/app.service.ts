import { Firestore } from '@google-cloud/firestore';
import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { Cache } from '@nestjs/cache-manager';
import { NotifyUser, ServiceEvent, ServiceMessage, SocketSend, UserNotificationPayload } from 'hide-common';
import { FirestoreService } from 'hide-firebase';
import { RedisService } from 'hide-redis';
import { notificationConverter } from './utils/converter';
import { NotificationReadDTO } from './common/dto';

@Injectable()
export class AppService {
  private db: Firestore;
  private cache: Cache;

  constructor(
    @Inject('NOTIFICATION_SERVICE_REDIS') private redis: ClientProxy,
    private readonly firestore: FirestoreService,
    private readonly redisService: RedisService,
  ) {
    this.db = this.firestore.db;
    this.cache = this.redisService.get();
  }

  async pushNotification(data: ServiceMessage<NotifyUser<UserNotificationPayload>>) {
    await this.db
      .collection('notifications')
      .doc(data.payload.uid)
      .collection('messages')
      .doc(data.payload.notification.id)
      .set(data.payload.notification);

    const presence = await this.cache.get<boolean>(`presence:${data.payload.uid}`);
    if (presence) {
      this.redis.emit<any, ServiceEvent<SocketSend<'notification'>>>('socket.send', {
        payload: {
          uid: data.payload.uid,
          pattern: 'notification',
          msg: { action: 'new', payload: data.payload.notification },
        },
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
    this.redis.emit<any, ServiceEvent<SocketSend<'notification'>>>('socket.send', {
      payload: {
        uid,
        pattern: 'notification',
        msg: { action: 'pending', payload: pendingNtfns },
      },
    });
  }

  async handleReadNotification(uid: string, data: NotificationReadDTO, ignorePersistent: boolean = true) {
    const docRef = this.db.collection('notifications').doc(uid).collection('messages').doc(data.id);
    const doc = await docRef.withConverter(notificationConverter).get();

    if (!doc.exists) return;
    const ntfn = doc.data()!;
    if (ignorePersistent && ntfn.action === 'workspace-invite') return;

    await docRef.delete();
  }

  async getAllNotifications(uid: string) {
    const snap = await this.db
      .collection('notifications')
      .doc(uid)
      .collection('messages')
      .withConverter(notificationConverter)
      .get();

    return snap.docs.map((doc) => doc.data());
  }
}
