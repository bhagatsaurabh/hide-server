import {
  All,
  Controller,
  HttpStatus,
  NotFoundException,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { User } from 'hide-common/model/user';
import { minimatch } from 'minimatch';

import { Authenticate } from 'src/common/decorator/auth.decorator';
import { AuthGuard } from 'src/common/guard/auth.guard';
import { Methods, Rule, rules } from './translations';
import { ExtTransport } from 'hide-common';
import { ProxyService } from './proxy.service';

@Controller('api')
export class ProxyController {
  constructor(private readonly proxyService: ProxyService) {}

  @All(':service/*path')
  @UseGuards(AuthGuard)
  async proxyRequest(
    @Param('service') serviceName: string,
    @Param('path') path: string[],
    @Query() queries: Record<string, string>,
    @Req() req: Request,
    @Res() res: Response,
    @Authenticate() user: User,
  ) {
    let matchedRule: Rule | null = null;
    const servicePath = path.join('/');
    for (const rule of rules) {
      if (minimatch(serviceName, rule.service)) {
        matchedRule = rule;
        break;
      }
    }
    const translation = matchedRule?.paths[servicePath]?.[req.method as Methods];
    if (!translation) {
      throw new NotFoundException();
    }

    let status = HttpStatus.OK,
      data: any;
    if (translation.targetProtocol === ExtTransport.HTTP) {
      ({ status, data } = await this.proxyService.sendRequest(serviceName, servicePath, req, user, queries));
    } else {
      data = await this.proxyService.sendMessage(translation, req, user, queries);
    }
    res.status(status).send(data);
  }
}
