import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Workspace } from './common/model/workspace.entity';
import { ManageModule } from './manage/manage.module';
import { InviteModule } from './invite/invite.module';
import { ClientsModule, Transport } from '@nestjs/microservices';

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
      entities: [Workspace],
      synchronize: process.env.NODE_ENV === 'development',
    }),
    ClientsModule.register([
      {
        name: 'WORKSPACE_SERVICE',
        transport: Transport.RMQ,
        options: {
          urls: [process.env.RMQ_URL!],
          queue: 'default',
          queueOptions: {
            durable: false,
          },
        },
      },
    ]),
    ManageModule,
    InviteModule,
  ],
})
export class AppModule {}
