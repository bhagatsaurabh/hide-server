import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { IUser } from './models';

export const UserHeader = createParamDecorator((data: string, ctx: ExecutionContext): IUser | null => {
  const request = ctx.switchToHttp().getRequest<Request>();
  const userHeader = request.header('x-auth-user');
  if (!userHeader) {
    return null;
  }
  return JSON.parse(Buffer.from(userHeader, 'base64').toString()) as IUser;
});
