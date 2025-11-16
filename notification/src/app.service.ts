import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { Cache } from '@nestjs/cache-manager';
import {
  CachedPresence,
  CACHEKEY_PRESENCE,
  isNotificationPersistent,
  NotifyUser,
  ServiceEvent,
  ServiceMessage,
  SocketSend,
  UserNotificationPayload,
} from 'hide-common';
import { FirestoreService } from 'hide-firebase';
import { RedisService } from 'hide-redis';
import { notificationConverter } from './utils/converter';
import { firestore } from 'firebase-admin';

@Injectable()
export class AppService {
  private db: firestore.Firestore;
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
      .withConverter(notificationConverter)
      .doc(data.payload.notification.id)
      .set({ ...data.payload.notification, createdOn: new Date(data.payload.notification.createdOn) });

    const presence = await this.cache.get<CachedPresence>(CACHEKEY_PRESENCE(data.payload.uid));
    if (!presence) return;

    Object.keys(presence).forEach((sessionId) => {
      this.redis.emit<any, ServiceEvent<SocketSend<'notification'>>>('socket.send', {
        meta: { uid: data.payload.uid, sessionId },
        payload: {
          uid: data.payload.uid,
          sessionId,
          pattern: 'notification',
          msg: { action: 'new', payload: data.payload.notification },
        },
      });
    });
  }

  async pushAllPendingNotifications(uid: string) {
    const snap = await this.db
      .collection('notifications')
      .doc(uid)
      .collection('messages')
      .withConverter(notificationConverter)
      .get();

    const pendingNtfns = snap.docs.map((doc) => doc.data());
    const presence = await this.cache.get<boolean>(CACHEKEY_PRESENCE(uid));
    if (!presence) return;

    Object.keys(presence).forEach((sessionId) => {
      this.redis.emit<any, ServiceEvent<SocketSend<'notification'>>>('socket.send', {
        meta: { uid, sessionId },
        payload: {
          uid,
          sessionId,
          pattern: 'notification',
          msg: { action: 'pending', payload: pendingNtfns },
        },
      });
    });
  }

  async handleReadNotification(
    uid: string,
    ntfnId: string,
    ignorePersistent: boolean = true,
    systemRead = false,
  ) {
    const docRef = this.db.collection('notifications').doc(uid).collection('messages').doc(ntfnId);
    const doc = await docRef.withConverter(notificationConverter).get();

    if (doc.exists) {
      const ntfn = doc.data()!;
      if (!ignorePersistent || !isNotificationPersistent(ntfn)) {
        await docRef.delete();
      }
    }

    if (systemRead) {
      const presence = await this.cache.get<CachedPresence>(CACHEKEY_PRESENCE(uid));
      if (!presence) return;

      Object.keys(presence).forEach((sessionId) => {
        this.redis.emit<any, ServiceEvent<SocketSend<'notification'>>>('socket.send', {
          meta: { uid, sessionId },
          payload: {
            uid,
            sessionId,
            pattern: 'notification',
            msg: {
              action: 'directive',
              payload: { type: 'notification-delete', id: ntfnId, createdOn: '0' },
            },
          },
        });
      });
    }
  }

  async handleReadAllNotifications(uid: string, ntfnIds: string[]) {
    const batch = this.db.batch();
    ntfnIds.forEach((ntfnId) => {
      const docRef = this.db.collection('notifications').doc(uid).collection('messages').doc(ntfnId);
      batch.delete(docRef);
    });
    await batch.commit();
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
