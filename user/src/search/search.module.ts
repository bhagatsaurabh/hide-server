import { Module } from '@nestjs/common';
import { SearchService } from './search.service';
import { SearchController } from './search.controller';
import { TypesenseService } from 'src/typesense/typesense.service';
import { SharedModule } from 'src/common/shared.module';

@Module({
  imports: [SharedModule],
  controllers: [SearchController],
  providers: [SearchService, TypesenseService],
})
export class SearchModule {}
