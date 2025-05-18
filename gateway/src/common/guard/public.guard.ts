import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { verify } from 'jsonwebtoken';
import { JWTVerifyFn, ServicePayload } from 'hide-common/types/jwt';

@Injectable()
export class PublicGuard implements CanActivate {
  constructor() {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const authHeader = request.headers.authorization;

    if (!authHeader) {
      throw new UnauthorizedException('Authorization header missing');
    }

    const token = authHeader.split(' ')[1];

    try {
      let payload: ServicePayload;
      if (process.env.NODE_ENV === 'development') {
        payload = (verify as unknown as JWTVerifyFn<ServicePayload>)(token, process.env.JWT_PUBLIC_KEY!);
      } else {
        payload = (verify as unknown as JWTVerifyFn<ServicePayload>)(token, process.env.JWT_PUBLIC_KEY!, {
          algorithms: ['RS256'],
        });
      }

      if (payload.aud !== 'gateway-api' || payload.iss !== 'firebase-service') {
        return false;
      }

      console.log('verified');
      return true;
    } catch (err) {
      console.error('JWT verification failed:', err);
      throw new UnauthorizedException('Unauthorized access');
    }
  }
}
