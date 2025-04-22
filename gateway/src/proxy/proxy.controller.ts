import {
  All,
  BadGatewayException,
  Controller,
  HttpStatus,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { User } from 'hide-common/model/user';

import { Authenticate } from 'src/common/decorator/auth.decorator';
import { AuthGuard } from 'src/common/guard/auth.guard';
import { rules } from './translations';
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

  @All(':service/:action')
  @UseGuards(AuthGuard)
  async proxyRequest(
    @Param('service') serviceName: string,
    @Param('action') action: string,
    @Query() queries: Record<string, string>,
    @Req() req: Request,
    @Res() res: Response,
    @Authenticate() user: User,
  ) {
    const rule = rules[serviceName]?.[action]?.[req.method as 'GET'];
    if (!rule) {
      throw new BadGatewayException();
    }

    let status = HttpStatus.OK,
      data: any;
    if (rule.targetProtocol === ExtTransport.HTTP) {
      ({ status, data } = await this.proxyService.sendRequest(serviceName, action, req, user, queries));
    }
    if (rule.targetProtocol === Transport.REDIS) {
      data = await this.proxyService.sendMessage(rule.pattern!, req, user, queries);
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
