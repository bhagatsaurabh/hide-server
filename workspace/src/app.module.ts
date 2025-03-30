import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Workspace } from './common/model/workspace.entity';
import { ManageModule } from './manage/manage.module';
import { InviteModule } from './invite/invite.module';
import { Membership } from './common/model/membership.entity';

@Module({
  imports: [
    ConfigModule.forRoot(),
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.POSTGRES_HOST!,
      port: parseInt(process.env.POSTGRES_PORT!),
      username: process.env.POSTGRES_USER,
      password: process.env.POSTGRES_PASS,
      database: process.env.POSTGRES_DB,
      entities: [Workspace, Membership],
      synchronize: process.env.NODE_ENV === 'development',
    }),
    ManageModule,
    InviteModule,
  ],
})
export class AppModule {}
