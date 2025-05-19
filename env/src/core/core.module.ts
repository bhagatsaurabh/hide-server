import { Module } from '@nestjs/common';
import { CoreController } from './core.controller';
import { SharedModule } from 'src/common/shared.module';

@Module({
  imports: [SharedModule],
  controllers: [CoreController],
  providers: [],
})
export class CoreModule {}
