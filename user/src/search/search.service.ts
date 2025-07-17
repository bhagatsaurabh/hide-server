import { Injectable, NotFoundException } from '@nestjs/common';
import { User } from 'hide-common/model/user';
import { RedisService } from 'hide-redis';
import { SearchParams } from 'typesense/lib/Typesense/Documents';
import { Cache } from 'cache-manager';
import { FirestoreService } from 'hide-firebase';
import { CollectionReference, DocumentData, Firestore } from '@google-cloud/firestore';
import { UserSearchDTO } from 'src/common/dto';
import { TypesenseService } from 'src/typesense/typesense.service';
import { userConverter } from 'src/utils/converters';
import { OneOrMore } from 'src/utils/helpers';
import { CACHEKEY_USER_PROFILE } from 'hide-common';

@Injectable()
export class SearchService {
  private cache: Cache;
  private db: Firestore;
  private collection: CollectionReference<Partial<User>, DocumentData>;

  constructor(
    private readonly typesenseService: TypesenseService,
    private readonly redisService: RedisService,
    private readonly firestoreService: FirestoreService,
  ) {
    this.cache = this.redisService.get();
    this.db = this.firestoreService.db;
    this.collection = this.db.collection('users').withConverter(userConverter);
  }

  async searchUsers(uid: string, query: string, page = 1): Promise<UserSearchDTO> {
    const searchParams: SearchParams = {
      q: query,
      query_by: ['name', 'username'],
      exclude_fields: ['email'],
      filter_by: `uid:!=${uid}`,
      infix: ['always', 'always'],
      per_page: 5,
      page: page || 1,
    };
    const res = await this.typesenseService.client
      .collections<Partial<User>>('users')
      .documents()
      .search(searchParams);

    const result: UserSearchDTO = { data: [], page: res.page };
    if (res.hits) {
      result.data = res.hits.map((hit) => ({
        doc: hit.document,
        highlights: hit.highlights!.map((highlight) => ({
          field: highlight.field,
          snippet: highlight.snippet!,
        })),
      }));
    }
    return result;
  }

  async getProfile(uid: string, actorUid: string): Promise<Partial<User>> {
    let profile = await this.cache.get<Partial<User>>(CACHEKEY_USER_PROFILE(uid));
    if (profile) {
      return this.hideConfidentialFields(profile, actorUid);
    }

    const snap = await this.collection.where('uid', '==', uid).get();
    if (snap.empty) {
      throw new NotFoundException('User id not found');
    }
    profile = snap.docs[0].data();
    await this.cache.set(CACHEKEY_USER_PROFILE(uid), profile);
    return this.hideConfidentialFields(profile, actorUid);
  }

  async getUsers(ids: string[], uid: string): Promise<(Partial<User> | null)[]> {
    let cachedUsers = await Promise.all(
      ids.map((id) => {
        return this.cache.get<Partial<User>>(`users:${id}`);
      }),
    );
    const dbPromises = cachedUsers.map((cachedUser, idx) => {
      if (cachedUser) return cachedUser;
      return this.fetchUserFromDB(ids[idx]);
    });
    cachedUsers = await Promise.all(dbPromises);

    cachedUsers.forEach((user) => delete user?.issuer);
    return this.hideConfidentialFields(cachedUsers, uid);
  }

  private hideConfidentialFields<T extends OneOrMore<Partial<User> | null>>(data: T, uid: string) {
    if (!Array.isArray(data)) {
      if (data && data.uid !== uid) {
        delete data.email;
      }
      return data;
    }
    data.forEach((profile) => {
      if (profile && profile.uid !== uid) delete profile.email;
    });
    return data;
  }
  private async fetchUserFromDB(uid: string): Promise<Partial<User> | null> {
    try {
      const snap = await this.db
        .collection('users')
        .withConverter(userConverter)
        .where('uid', '==', uid)
        .get();
      if (!snap.empty && snap.docs.length) {
        const data = snap.docs[0].data();
        await this.cache.set(`users:${uid}`, data);
        return data;
      }
    } catch (error) {
      void error;
      return null;
    }
    return null;
  }
}
