import { Cache } from '@nestjs/cache-manager';
import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { CACHEKEY_USER_PROFILE } from 'hide-common';
import { User } from 'hide-common/model/user';
import { userConverter } from 'hide-common';
import { FirestoreService } from 'hide-firebase';
import { RedisService } from 'hide-redis';
import { firestore } from 'firebase-admin';

export interface AuthenticatedRequest extends Request {
  user?: User;
}

@Injectable()
export class AuthGuard implements CanActivate {
  cache: Cache;
  db: firestore.Firestore;

  constructor(
    private readonly redis: RedisService,
    private readonly firestore: FirestoreService,
  ) {
    this.cache = this.redis.get();
    this.db = this.firestore.db;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    let token = request.headers.authorization;

    if (!token) {
      throw new UnauthorizedException('Authorization header missing');
    }

    token = token.startsWith('Bearer ') ? token.split(' ')[1] : token;

    try {
      const response = await fetch(`http://auth/api/validate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        throw new UnauthorizedException('Invalid token');
      }
      const userData = (await response.json()) as User;
      request.user = userData;

      if (request.path === '/api/user/register') return true;

      // Check profile validity
      let userProfile = await this.cache.get<User>(CACHEKEY_USER_PROFILE(userData.uid));
      if (!userProfile) {
        const profileSnap = await this.db
          .collection('users')
          .withConverter(userConverter(this.firestore.Timestamp))
          .where('uid', '==', userData.uid)
          .get();
        userProfile = profileSnap.docs.length > 0 ? profileSnap.docs[0].data() : undefined;
        if (userProfile) {
          await this.cache.set(CACHEKEY_USER_PROFILE(userData.uid), userProfile);
        }
      }

      return !!userProfile;
    } catch (error) {
      console.log(error);
      throw new UnauthorizedException('Authentication failed');
    }
  }
}
