import { All, Controller, Param, Req, Res, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';
import { User } from 'hide-common/model/user';

import { Authenticate } from 'src/common/decorator/auth.decorator';
import { AuthGuard } from 'src/common/guard/auth.guard';

@Controller('api')
export class ProxyController {
  constructor() {}

  @All(':service/:action')
  @UseGuards(AuthGuard)
  async proxyRequest(
    @Param('service') serviceName: string,
    @Param('action') action: string,
    @Req() req: Request,
    @Res() res: Response,
    @Authenticate() user: User,
  ) {
    try {
      const response = await fetch(`http://${serviceName}/api/${action}`, {
        method: req.method,
        body: ['GET', 'HEAD'].includes(req.method) ? undefined : JSON.stringify(req.body),
        headers: {
          'Content-Type': req.headers['content-type'] || 'application/json',
          'x-auth-user': Buffer.from(JSON.stringify(user)).toString('base64'),
        },
      });
      console.log('proxy end');

      const responseData = await response.text();
      res.status(response.status).send(responseData);
    } catch (error) {
      console.error(`Error forwarding request: ${error}`);
    }
  }
}
