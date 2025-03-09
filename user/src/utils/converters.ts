import { User } from 'hide-common/model/user';

export const userConverter = {
  toFirestore: (data: User) => data,
  fromFirestore: (snap: FirebaseFirestore.QueryDocumentSnapshot) => snap.data() as User,
};
