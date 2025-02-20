import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CoreModule } from './core/core.module';

@Module({
  imports: [ConfigModule.forRoot(), CoreModule],
})
export class AppModule {}
