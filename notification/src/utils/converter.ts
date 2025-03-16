import { NotificationMessage } from 'hide-common/message/notification.message';

export const notificationConverter = {
  toFirestore: (data: NotificationMessage) => data,
  fromFirestore: (snap: FirebaseFirestore.QueryDocumentSnapshot) => snap.data() as NotificationMessage,
};
