import { Auth } from 'firebase-admin/auth';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { User } from 'hide-common/model/user';
import { FirebaseService } from 'hide-firebase';
import { RedisService } from 'hide-redis';
import { CreateUserDTO } from 'src/common/dto';
import { emailRegex, nameRegex, usernameRegex } from 'src/utils/constants';
import { userConverter } from 'hide-common';
import { isObjEmpty } from 'src/utils/helpers';
import { Cache } from '@nestjs/cache-manager';
import { CACHEKEY_USER_PROFILE } from 'hide-common';
import { firestore } from 'firebase-admin';

@Injectable()
export class ProfileService {
  private readonly db: firestore.Firestore;
  private readonly auth: Auth;
  cache: Cache;

  constructor(
    private readonly firebase: FirebaseService,
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
        .withConverter(userConverter(this.firebase.Timestamp))
        .doc(data.username)
        .set({
          ...user,
          name: data.name,
          username: data.username,
          picture: data.picture ?? '',
          ...additionalFields,
        });

      await this.cache.set(CACHEKEY_USER_PROFILE(user.uid), user);
    } else {
      throw new BadRequestException('USER_ALREADY_REGISTERED');
    }
  }

  async deleteUser(user: User) {
    const snap = await this.db
      .collection('users')
      .withConverter(userConverter(this.firebase.Timestamp))
      .where('uid', '==', user.uid)
      .get();
    if (snap.empty) {
      throw new NotFoundException('USER_DOES_NOT_EXIST');
    }
    const { username } = snap.docs[0].data();

    await this.db.collection('users').doc(username).delete();
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

    const snap = await this.db
      .collection('users')
      .withConverter(userConverter(this.firebase.Timestamp))
      .where('uid', '==', uid)
      .get();
    if (snap.empty || !snap.docs.length) {
      throw new NotFoundException('USER_NOT_FOUND');
    } else {
      const oldUser = snap.docs[0].data();

      if (updatedUser.username && updatedUser.username !== oldUser.username) {
        await this.db
          .collection('users')
          .withConverter(userConverter(this.firebase.Timestamp))
          .doc(updatedUser.username)
          .set({ ...oldUser, ...updatedUser });
      } else {
        await this.db.collection('users').doc(oldUser.username).update(updatedUser);
      }
    }
  }

  private validateCreateUser(data: CreateUserDTO) {
    if (!data.name || !data.username) {
      return 'USER_DETAILS_MISSING';
    }
    if (!nameRegex.test(data.name)) {
      return 'INVALID_USER_NAME';
    }
    if (!usernameRegex.test(data.username)) {
      return 'INVALID_USER_USERNAME';
    }
  }

  private validateUpdateUser(uid: string, user: Partial<User>) {
    if (user.name && !nameRegex.test(user.name)) {
      return 'INVALID_USER_NAME';
    }
    if (user.username && !usernameRegex.test(user.username)) {
      return 'INVALID_USER_USERNAME';
    }
    if (user.email && !emailRegex.test(user.email)) {
      return 'INVALID_EMAIL';
    }
    if (user.uid !== uid) return 'INVALID_USER_IDENTITY';
    if (user.expireAt) return 'UPDATE_USER_FORBIDDEN';
  }
}
