import { UserNotificationPayload } from 'hide-common';

export const notificationConverter = {
  toFirestore: (data: UserNotificationPayload) => data,
  fromFirestore: (snap: FirebaseFirestore.QueryDocumentSnapshot) => snap.data() as UserNotificationPayload,
};
