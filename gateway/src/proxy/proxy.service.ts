import { BadGatewayException, GatewayTimeoutException, Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { Request } from 'express';
import { File } from 'hide-common';
import { User } from 'hide-common/model/user';
import { timeout } from 'rxjs';
import { createMessage } from 'src/utils';

@Injectable()
export class ProxyService {
  constructor(@Inject('GATEWAY_SERVICE_REDIS') private redis: ClientProxy) {}

  async sendRequest(
    serviceName: string,
    action: string,
    req: Request,
    user: User,
    queries: Record<string, string>,
  ) {
    try {
      let url = `http://${serviceName}/api/${action}`;
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

  async sendMessage(pattern: string, req: Request, user: User, queries: Record<string, string>) {
    let payload = {};
    if (queries) {
      payload = { ...payload, ...queries };
    }
    if (req.body) {
      payload = { ...payload, ...(req.body as object) };
    }
    const observable = this.redis
      .send<File[]>(pattern, createMessage(user.uid, req.path, payload))
      .pipe(timeout(3000));

    return new Promise<File[]>((res, rej) => {
      let data: File[],
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
