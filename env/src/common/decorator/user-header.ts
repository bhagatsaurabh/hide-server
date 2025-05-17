import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { User } from '../model/user';

export const UserHeader = createParamDecorator((_data: string, ctx: ExecutionContext): User | null => {
  const request = ctx.switchToHttp().getRequest<Request>();
  const userHeader = request.header('x-auth-user');
  if (!userHeader) {
    return null;
  }
  return JSON.parse(Buffer.from(userHeader, 'base64').toString()) as User;
});
