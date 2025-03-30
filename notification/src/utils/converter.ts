import { NotificationMessage } from 'hide-common';

export const notificationConverter = {
  toFirestore: (data: NotificationMessage<any>) => data,
  fromFirestore: (snap: FirebaseFirestore.QueryDocumentSnapshot) => snap.data() as NotificationMessage<any>,
};
