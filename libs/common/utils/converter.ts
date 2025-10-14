import { User } from "../model/user";
import {
  type DocumentData,
  type FirestoreDataConverter,
  type QueryDocumentSnapshot,
  type Timestamp,
} from "firebase-admin/firestore";

export const userConverter: (Timestamp: {
  fromDate: (d: Date) => any;
}) => FirestoreDataConverter<User> = (Timestamp) => ({
  toFirestore: (data: User): DocumentData => {
    const user: DocumentData = {
      uid: data.uid,
      name: data.name,
      username: data.username,
      email: data.email,
      picture: data.picture,
      issuer: data.issuer,
    };

    if (data.expireAt) {
      user.expireAt = Timestamp.fromDate(new Date(data.expireAt));
    }

    return user;
  },
  fromFirestore: (snap: QueryDocumentSnapshot): User => {
    const data = snap.data();
    const user: User = {
      uid: data.uid as string,
      name: data.name as string,
      username: data.username as string,
      email: data.email as string,
      picture: data.picture as string,
      issuer: data.issuer as string,
    };
    if (data.expireAt) {
      user.expireAt = (data.expireAt as Timestamp).toDate().toISOString();
    }
    return user;
  },
});
