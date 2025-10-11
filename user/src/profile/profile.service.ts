import { Firestore } from '@google-cloud/firestore';
import { Auth } from 'firebase-admin/auth';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { User } from 'hide-common/model/user';
import { FirebaseService, FirestoreService } from 'hide-firebase';
import { RedisService } from 'hide-redis';
import { CreateUserDTO } from 'src/common/dto';
import { emailRegex, nameRegex, usernameRegex } from 'src/utils/constants';
import { userConverter } from 'src/utils/converters';
import { isObjEmpty } from 'src/utils/helpers';
import { Cache } from '@nestjs/cache-manager';

@Injectable()
export class ProfileService {
  private readonly db: Firestore;
  private readonly auth: Auth;
  cache: Cache;

  constructor(
    private readonly firebase: FirebaseService,
    private readonly firestore: FirestoreService,
    private readonly cacheService: RedisService,
  ) {
    this.db = this.firebase.firestore;
    this.auth = this.firebase.auth;
    this.cache = this.cacheService.get();
  }

  async createUser(user: User, data: CreateUserDTO) {
    let err: string | undefined;
    if ((err = this.validateCreateUser(data))) {
      throw new BadRequestException(err);
    }

    const countSnap = await this.db.collection('users').where('uid', '==', user.uid).count().get();
    if (countSnap.data().count <= 0) {
      const additionalFields: { expireAt?: string } = {};
      const usr = await this.auth.getUser(user.uid);
      if (!usr.providerData.length) {
        additionalFields.expireAt = new Date(
          Date.now() + +(process.env.GUEST_ACCOUNT_EXPIRY_DAYS ?? '2') * 24 * 60 * 60 * 1000,
        ).toISOString();
      }

      await this.db
        .collection('users')
        .withConverter(userConverter)
        .doc(data.username)
        .set({
          ...user,
          name: data.name,
          username: data.username,
          picture: data.picture ?? '',
          ...additionalFields,
        });

      await this.cache.set(`profile:${user.uid}`, true);
    } else {
      throw new BadRequestException('User is already registered');
    }
  }

  async updateUser(uid: string, user: Partial<User>) {
    let err: string | undefined;
    if ((err = this.validateUpdateUser(uid, user))) {
      throw new BadRequestException(err);
    }

    const updatedUser: Partial<User> = {};
    if (user.name) {
      updatedUser.name = user.name;
    }
    if (user.username) {
      updatedUser.username = user.username;
    }
    if (user.email) {
      updatedUser.email = user.email;
    }
    if (user.picture) {
      updatedUser.picture = user.picture;
    }

    if (isObjEmpty(updatedUser)) return;

    const snap = await this.db.collection('users').withConverter(userConverter).where('uid', '==', uid).get();
    if (snap.empty || !snap.docs.length) {
      throw new NotFoundException('User not found');
    } else {
      const oldUser = snap.docs[0].data();

      if (updatedUser.username && updatedUser.username !== oldUser.username) {
        await this.db
          .collection('users')
          .doc(updatedUser.username)
          .set({ ...oldUser, ...updatedUser });
      } else {
        await this.db.collection('users').doc(oldUser.username).update(updatedUser);
      }
    }
  }

  private validateCreateUser(data: CreateUserDTO) {
    if (!data.name || !data.username) {
      return 'Full details not provided';
    }
    if (!nameRegex.test(data.name)) {
      return 'Not a valid name';
    }
    if (!usernameRegex.test(data.username)) {
      return 'Not a valid username';
    }
  }

  private validateUpdateUser(uid: string, user: Partial<User>) {
    if (user.name && !nameRegex.test(user.name)) {
      return 'Not a valid name';
    }
    if (user.username && !usernameRegex.test(user.username)) {
      return 'Not a valid username';
    }
    if (user.email && !emailRegex.test(user.email)) {
      return 'Not a valid email';
    }
    if (user.uid !== uid) return 'Not a valid uid';
  }
}
