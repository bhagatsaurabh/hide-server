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
import { EventPattern, Transport } from '@nestjs/microservices';
import { ExtTransport, FSSync, SocketMessageType } from 'hide-common';
import { ProxyService } from './proxy.service';
import { SocketGateway } from 'src/socket/socket.gateway';

@Controller('api')
export class ProxyController {
  constructor(
    private readonly proxyService: ProxyService,
    private readonly socketsGateway: SocketGateway,
  ) {}

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
    }
    if (translation.targetProtocol === Transport.REDIS) {
      data = await this.proxyService.sendMessage(translation.pattern!, req, user, queries);
    }
    res.status(status).send(data);
  }

  @EventPattern('fs:sync')
  async handleFSSync(data: FSSync) {
    await this.socketsGateway.send<FSSync>(data.uid, {
      uid: data.uid,
      type: SocketMessageType.FILESYSTEM,
      data,
    });
  }
}
