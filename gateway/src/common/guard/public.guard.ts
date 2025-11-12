import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { verify } from 'jsonwebtoken';
import { JWTVerifyFn, ServicePayload } from 'hide-common/types/jwt';
import { allowedaud, allowedIss } from 'src/utils/constants';
import { Reflector } from '@nestjs/core';

@Injectable()
export class PublicGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const metadata = this.reflector.get<{ publicGuardType: string }>('guard-metadata', context.getHandler());

    const request = context.switchToHttp().getRequest<Request>();
    let token: string | undefined;

    if (metadata.publicGuardType === 'workspace') {
      token = request.query?.['token'] as string;
    } else {
      const authHeader = request.headers.authorization;
      token = authHeader?.split(' ')?.[1];
    }

    if (!token) {
      throw new UnauthorizedException('Authorization header or token param is missing');
    }

    try {
      let payload: ServicePayload;
      if (metadata.publicGuardType === 'workspace') {
        payload = this.verifyWorkspaceToken(token);
      } else {
        payload = this.verifyCommonToken(token);
      }

      if (!allowedaud.includes(payload.aud) || !allowedIss.includes(payload.iss)) {
        return false;
      }

      return true;
    } catch (err) {
      console.error('JWT verification failed:', err);
      throw new UnauthorizedException('Unauthorized access');
    }
  }

  verifyWorkspaceToken(token: string) {
    return (verify as unknown as JWTVerifyFn<ServicePayload>)(token, process.env.WORKSPACE_SERVICE_SECRET!);
  }
  verifyCommonToken(token: string) {
    if (process.env.NODE_ENV === 'development') {
      return (verify as unknown as JWTVerifyFn<ServicePayload>)(token, process.env.JWT_PUBLIC_KEY!);
    } else {
      return (verify as unknown as JWTVerifyFn<ServicePayload>)(
        token,
        Buffer.from(process.env.JWT_PUBLIC_KEY!, 'base64').toString(),
        {
          algorithms: ['RS256'],
        },
      );
    }
  }
}
