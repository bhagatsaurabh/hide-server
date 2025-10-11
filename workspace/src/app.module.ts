import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Workspace } from './common/model/workspace.entity';
import { ManageModule } from './manage/manage.module';
import { InviteModule } from './invite/invite.module';
import { Membership } from './common/model/membership.entity';
import { RedisModule } from 'hide-redis';
import { HealthModule } from 'hide-health';
import { FirebaseModule } from 'hide-firebase';
import { readFileSync } from 'node:fs';
import { AccessCode } from './common/model/access-codes.entity';

@Module({
  imports: [
    ConfigModule.forRoot(),
    RedisModule.register({ host: process.env.REDIS_HOST!, port: process.env.REDIS_PORT!, database: '1' }),
    FirebaseModule.register({
      key: process.env.FIREBASE_EMULATION
        ? undefined
        : process.env.FIREBASE_KEY
          ? readFileSync(process.env.FIREBASE_KEY, 'utf-8')
          : Buffer.from(process.env.FIREBASE_KEY_BASE64!, 'base64').toString(),
      emulate: !!process.env.FIREBASE_EMULATION,
    }),
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.POSTGRES_HOST!,
      port: parseInt(process.env.POSTGRES_PORT!),
      username: process.env.POSTGRES_USER,
      password: process.env.POSTGRES_PASSWORD,
      database: process.env.POSTGRES_DB,
      entities: [Workspace, Membership, AccessCode],
      autoLoadEntities: true,
      synchronize: process.env.NODE_ENV === 'development',
    }),
    ManageModule,
    InviteModule,
    HealthModule.register(),
  ],
})
export class AppModule {}
