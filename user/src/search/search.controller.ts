import { Body, Controller, Get, Inject, OnModuleInit, Param, Post, Query } from '@nestjs/common';
import { UserHeader } from 'hide-common';
import { User } from 'hide-common/dto/user';
import { SearchService } from './search.service';
import { ClientProxy } from '@nestjs/microservices';
import { RedisRef } from 'src/common/redis-ref';

@Controller('api')
export class SearchController implements OnModuleInit {
  constructor(
    private readonly searchService: SearchService,
    @Inject('USER_SERVICE_RMQ') private _rmq: ClientProxy,
    // @Inject('USER_SERVICE_REDIS') private redis: ClientProxy,
  ) {}

  async onModuleInit() {
    const [pub, sub] = RedisRef.get();

    await sub.subscribe('test.pattern');
    sub.on('message', (chan, message) => {
      if (chan !== 'test.pattern') return;
      const parsed = JSON.parse(message) as { id: string; data: unknown };
      console.log('Received: ', parsed);
      if (parsed.id) {
        void pub.publish(
          `${chan}.reply`,
          JSON.stringify({ id: parsed.id, data: { beep: 'boop' }, pattern: `${chan}.reply` }),
        );
      }
    });
  }

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
