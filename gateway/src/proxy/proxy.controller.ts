import { All, Controller, Param, Req, Res, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';

import { EurekaService } from 'eureka';
import { Authenticate } from 'src/common/decorator/auth.decorator';
import { IUser } from 'src/common/models/user';
import { AuthGuard } from 'src/common/guard/auth.guard';

@Controller('api')
export class ProxyController {
  constructor(private readonly eurekaService: EurekaService) {}

  @All(':service/:action')
  @UseGuards(AuthGuard)
  async proxyRequest(
    @Param('service') service: string,
    @Param('action') action: string,
    @Req() req: Request,
    @Res() res: Response,
    @Authenticate() user: IUser,
  ) {
    try {
      console.log(user);
      console.log(service, action);
      const serviceUrl = await this.eurekaService.getService(service);
      const response = await fetch(`${serviceUrl}/api/${action}`, {
        method: req.method,
        body: ['GET', 'HEAD'].includes(req.method) ? undefined : JSON.stringify(req.body),
        headers: {
          'Content-Type': req.headers['content-type'] || 'application/json',
          'x-auth-user': Buffer.from(JSON.stringify(user)).toString('base64'),
        },
      });

      const responseData = await response.text();
      res.status(response.status).send(responseData);
    } catch (error) {
      console.error(`Error forwarding request: ${error}`);
    }
  }
}
