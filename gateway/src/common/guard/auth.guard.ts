import { Firestore } from '@google-cloud/firestore';
import { Cache } from '@nestjs/cache-manager';
import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { User } from 'hide-common/model/user';
import { FirestoreService } from 'hide-firebase';
import { RedisService } from 'hide-redis';

export interface AuthenticatedRequest extends Request {
  user?: User;
}

@Injectable()
export class AuthGuard implements CanActivate {
  cache: Cache;
  db: Firestore;

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

      // Check profile validity
      let isProfileCreated = await this.cache.get<boolean>(`profile:${userData.uid}`);
      if (isProfileCreated === null) {
        const profileSnap = await this.db.collection('users').where('uid', '==', userData.uid).get();
        isProfileCreated = profileSnap.docs.length > 0;
        await this.cache.set(`profile:${userData.uid}`, isProfileCreated);
      }

      return isProfileCreated;
    } catch (error) {
      console.log(error);
      throw new UnauthorizedException('Authentication failed');
    }
  }
}
