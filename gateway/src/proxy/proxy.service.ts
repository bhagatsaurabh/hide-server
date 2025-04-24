import { BadGatewayException, GatewayTimeoutException, Inject, Injectable } from '@nestjs/common';
import { ClientProxy, Transport } from '@nestjs/microservices';
import { Request } from 'express';
import { User } from 'hide-common/model/user';
import { Observable, timeout } from 'rxjs';
import { createMessage } from 'src/utils';
import { Translation } from './translations';

@Injectable()
export class ProxyService {
  constructor(
    @Inject('GATEWAY_SERVICE_REDIS') private redis: ClientProxy,
    @Inject('GATEWAY_SERVICE') private rmq: ClientProxy,
  ) {}

  async sendRequest(
    serviceName: string,
    path: string,
    req: Request,
    user: User,
    queries: Record<string, string>,
  ) {
    try {
      let url = `http://${serviceName}/api/${path}`;
      if (queries && Object.keys(queries).length > 0) {
        url += `/${new URLSearchParams(queries).toString()}`;
      }
      const response = await fetch(url, {
        method: req.method,
        body: req.body ? JSON.stringify(req.body) : undefined,
        headers: {
          'Content-Type': req.headers['content-type'] || 'application/json',
          'x-auth-user': Buffer.from(JSON.stringify(user)).toString('base64'),
        },
      });
      const responseData = await response.text();
      return { status: response.status, data: responseData };
    } catch (error) {
      console.error(`Error forwarding request: ${error}`);
      throw new BadGatewayException();
    }
  }

  async sendMessage(translation: Translation, req: Request, user: User, queries: Record<string, string>) {
    let payload = {};
    if (queries) {
      payload = { ...payload, ...queries };
    }
    if (req.body) {
      payload = { ...payload, ...(req.body as object) };
    }
    const msg = createMessage(user.uid, req.path, payload);
    let observable: Observable<unknown>;
    if (translation.targetProtocol === Transport.REDIS) {
      observable = this.redis.send(translation.pattern, msg).pipe(timeout(3000));
    } else if (translation.targetProtocol === Transport.RMQ) {
      observable = this.rmq.send(translation.pattern, msg).pipe(timeout(3000));
    }

    return new Promise<unknown>((res, rej) => {
      let data: unknown,
        success = true;
      observable.subscribe({
        next: (value) => void (data = value),
        error: () => {
          success = false;
          rej(new BadGatewayException());
        },
        complete: () => {
          if (success) res(data);
          else rej(new GatewayTimeoutException());
        },
      });
    });
  }
}
