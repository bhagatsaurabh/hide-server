import { HttpException, Inject, Injectable, InternalServerErrorException } from '@nestjs/common';
import { ClientProxy, Transport } from '@nestjs/microservices';
import { Request } from 'express';
import { User } from 'hide-common/model/user';
import { firstValueFrom, Observable, timeout } from 'rxjs';
import { Translation } from './translations';
import { createMessage, isRpcPayloadError, ServiceMessagePayload } from 'hide-common';

@Injectable()
export class ProxyService {
  constructor(
    @Inject('GATEWAY_SERVICE_REDIS') private redis: ClientProxy,
    @Inject('GATEWAY_SERVICE_NATS') private nats: ClientProxy,
    @Inject('GATEWAY_SERVICE_RMQ') private rmq: ClientProxy,
  ) {}

  async sendRequest(
    serviceName: string,
    path: string,
    req: Request,
    user: User,
    queries: Record<string, string>,
  ) {
    let url = `http://${serviceName}/api/${path}`;
    if (queries && Object.keys(queries).length > 0) {
      url += `?${new URLSearchParams(queries).toString()}`;
    }
    const response = await fetch(url, {
      method: req.method,
      body: req.body ? JSON.stringify(req.body) : undefined,
      headers: {
        'Content-Type': req.headers['content-type'] || 'application/json',
        'x-auth-user': Buffer.from(JSON.stringify(user)).toString('base64'),
      },
    });
    if (response.status < 200 || response.status > 299) {
      let error: unknown = null;
      try {
        error = await response.json();
      } catch (err) {
        void err;
      }
      console.error(response.status, error);
      throw new HttpException('Unknown error', response.status);
    }
    if (response.status === 204) return null;
    let data: unknown;
    try {
      data = (await response.json()) as unknown;
    } catch (error) {
      void error;
    }
    return data;
  }

  async sendMessage(translation: Translation, req: Request, user: User, queries: Record<string, string>) {
    let payload: ServiceMessagePayload = { reqAction: translation.action };
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
      observable = this.rmq.send(translation.pattern!, msg).pipe(timeout(3000));
    } else if (translation.targetProtocol === Transport.NATS) {
      observable = this.nats.send(translation.pattern!, msg).pipe(timeout(3000));
    } else {
      throw new InternalServerErrorException();
    }

    try {
      return await firstValueFrom<unknown>(observable);
    } catch (err: unknown) {
      if (isRpcPayloadError(err)) {
        throw new HttpException(err.message, err.statusCode);
      }
      throw new InternalServerErrorException();
    }
  }
}
