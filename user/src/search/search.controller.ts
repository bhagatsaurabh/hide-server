import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { UserHeader } from 'hide-common';
import { User } from 'hide-common/dto/user';
import { SearchService } from './search.service';

@Controller('api')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get('search')
  async search(@Query('q') query: string, @Query('page') page: number, @UserHeader() user: User) {
    return await this.searchService.searchUsers(user.uid, query, Number(page));
  }

  @Get('profile')
  async profile(@UserHeader() user: User) {
    return await this.searchService.getProfile(user.uid, user.uid);
  }

  @Post('all')
  async all(@Body() ids: string[], @UserHeader() user: User) {
    return await this.searchService.getUsers(ids, user.uid);
  }

  @Get(':uid')
  async one(@Param('uid') uid: string, @UserHeader() user: User) {
    return await this.searchService.getProfile(uid, user.uid);
  }
}
