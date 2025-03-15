import { Firestore } from '@google-cloud/firestore';
import { BadRequestException, Injectable } from '@nestjs/common';
import { User } from 'hide-common/model/user';
import { FirestoreService } from 'hide-firebase';
import { CreateUserDTO } from 'src/common/dto';
import { emailRegex, nameRegex, usernameRegex } from 'src/utils/constants';
import { isObjEmpty } from 'src/utils/helpers';

@Injectable()
export class ProfileService {
  private readonly db: Firestore;
  constructor(private readonly firestore: FirestoreService) {
    this.db = this.firestore.db;
  }

  async createUser(user: User, data: CreateUserDTO) {
    let err: string | undefined;
    if ((err = this.validateCreateUser(data))) {
      throw new BadRequestException(err);
    }

    await this.db
      .collection('users')
      .doc(user.uid)
      .set({ ...user, name: data.name, username: data.username });
  }

  async updateUser(uid: string, user: Partial<User>) {
    let err: string | undefined;
    if ((err = this.validateUpdateUser(user))) {
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

    if (!isObjEmpty(updatedUser)) {
      await this.db.collection('users').doc(uid).update(updatedUser);
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

  private validateUpdateUser(user: Partial<User>) {
    if (user.name && !nameRegex.test(user.name)) {
      return 'Not a valid name';
    }
    if (user.username && !usernameRegex.test(user.username)) {
      return 'Not a valid username';
    }
    if (user.email && !emailRegex.test(user.email)) {
      return 'Not a valid email';
    }
  }
}
