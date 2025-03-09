import { Controller } from '@nestjs/common';

@Controller()
export class SearchController {
  // Streaming search (metadata): Typesense
  // Self profile search on id: Redis cached
  // Batch search on ids: Redis cached
}
