import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { EurekaService } from 'eureka';
import { IUser } from '../models/user';

export interface AuthenticatedRequest extends Request {
  user?: IUser;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly eurekaService: EurekaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    let token = request.headers.authorization;

    if (!token) {
      throw new UnauthorizedException('Authorization header missing');
    }

    token = token.startsWith('Bearer ') ? token.split(' ')[1] : token;

    try {
      const authServiceUrl = await this.eurekaService.getService('auth');
      if (!authServiceUrl) {
        console.log('Auth service not found');
        throw new UnauthorizedException('Auth Service not found');
      }
      const response = await fetch(`${authServiceUrl}/validate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        throw new UnauthorizedException('Invalid token');
      }
      const userData = (await response.json()) as IUser;
      request.user = userData;
      return true;
    } catch (error) {
      console.log(error);
      throw new UnauthorizedException('Authentication failed');
    }
  }
}
