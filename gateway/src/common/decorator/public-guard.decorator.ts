import { SetMetadata } from '@nestjs/common';

export const GuardParam = (data: { publicGuardType: string }) => SetMetadata('guard-metadata', data);
