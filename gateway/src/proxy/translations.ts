import { Transport } from '@nestjs/microservices';
import { ExtTransport } from 'hide-common';

export type Translation = {
  sourceProtocol: Transport | ExtTransport;
  targetProtocol: Transport | ExtTransport;
  pattern?: string;
  action?: string;
};
export type Methods = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'OPTIONS';
type Paths = Record<string, Partial<Record<Methods, Translation>>>;
export type Rule = { service: string; paths: Paths };
type Rules = Array<Rule>;

export const rules: Rules = [
  {
    service: 'user',
    paths: {
      register: {
        POST: {
          sourceProtocol: ExtTransport.HTTP,
          targetProtocol: ExtTransport.HTTP,
        },
      },
      update: {
        PATCH: {
          sourceProtocol: ExtTransport.HTTP,
          targetProtocol: ExtTransport.HTTP,
        },
      },
      search: {
        GET: {
          sourceProtocol: ExtTransport.HTTP,
          targetProtocol: ExtTransport.HTTP,
        },
      },
      delete: {
        DELETE: {
          sourceProtocol: ExtTransport.HTTP,
          targetProtocol: ExtTransport.HTTP,
        },
      },
      '*': {
        GET: {
          sourceProtocol: ExtTransport.HTTP,
          targetProtocol: ExtTransport.HTTP,
        },
      },
    },
  },
  {
    service: 'notification',
    paths: {
      all: {
        GET: {
          sourceProtocol: ExtTransport.HTTP,
          targetProtocol: ExtTransport.HTTP,
        },
      },
      read: {
        POST: {
          sourceProtocol: ExtTransport.HTTP,
          targetProtocol: ExtTransport.HTTP,
        },
      },
      readall: {
        POST: {
          sourceProtocol: ExtTransport.HTTP,
          targetProtocol: ExtTransport.HTTP,
        },
      },
    },
  },
  {
    service: 'workspace-*',
    paths: {
      'dir/open': {
        GET: {
          sourceProtocol: ExtTransport.HTTP,
          targetProtocol: Transport.REDIS,
          pattern: 'fs:open',
        },
      },
      'dir/close': {
        POST: {
          sourceProtocol: ExtTransport.HTTP,
          targetProtocol: Transport.REDIS,
          pattern: 'fs:close',
        },
      },
      'file/open': {
        POST: {
          sourceProtocol: ExtTransport.HTTP,
          targetProtocol: Transport.REDIS,
          pattern: 'fs:open',
        },
      },
      'file/close': {
        POST: {
          sourceProtocol: ExtTransport.HTTP,
          targetProtocol: Transport.REDIS,
          pattern: 'fs:close',
        },
      },
      'file/save': {
        POST: {
          sourceProtocol: ExtTransport.HTTP,
          targetProtocol: Transport.REDIS,
          pattern: 'fs:save',
        },
      },
    },
  },
  {
    service: 'workspace',
    paths: {
      all: {
        GET: {
          sourceProtocol: ExtTransport.HTTP,
          targetProtocol: ExtTransport.HTTP,
        },
      },
      update: {
        PATCH: {
          sourceProtocol: ExtTransport.HTTP,
          targetProtocol: ExtTransport.HTTP,
        },
      },
      ignore: {
        POST: {
          sourceProtocol: ExtTransport.HTTP,
          targetProtocol: ExtTransport.HTTP,
        },
      },
      accept: {
        POST: {
          sourceProtocol: ExtTransport.HTTP,
          targetProtocol: ExtTransport.HTTP,
        },
      },
      'access-request': {
        POST: {
          sourceProtocol: ExtTransport.HTTP,
          targetProtocol: ExtTransport.HTTP,
        },
      },
      'access-delete': {
        DELETE: {
          sourceProtocol: ExtTransport.HTTP,
          targetProtocol: ExtTransport.HTTP,
        },
      },
      '*': {
        DELETE: {
          sourceProtocol: ExtTransport.HTTP,
          targetProtocol: ExtTransport.HTTP,
        },
      },
    },
  },
  {
    service: 'provisioner',
    paths: {
      provision: {
        POST: {
          sourceProtocol: ExtTransport.HTTP,
          targetProtocol: ExtTransport.HTTP,
        },
      },
    },
  },
  {
    service: 'env',
    paths: {
      open: {
        POST: {
          sourceProtocol: ExtTransport.HTTP,
          targetProtocol: Transport.NATS,
          pattern: 'env.msg',
          action: 'open',
        },
      },
      close: {
        POST: {
          sourceProtocol: ExtTransport.HTTP,
          targetProtocol: Transport.NATS,
          pattern: 'env.msg',
          action: 'close',
        },
      },
    },
  },
];
