import { Firestore } from '@google-cloud/firestore';
import { Injectable } from '@nestjs/common';
import { User } from 'hide-common/model/user';
import { FirestoreService } from 'hide-firebase';

@Injectable()
export class ProfileService {
  private readonly db: Firestore;
  constructor(private readonly firestore: FirestoreService) {
    this.db = this.firestore.db;
  }

  async createUser(user: User) {
    await this.db.collection('users').add(user);
  }
}
