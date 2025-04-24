import { Transport } from '@nestjs/microservices';
import { ExtTransport } from 'hide-common';

export type Translation = {
  sourceProtocol: Transport | ExtTransport;
  targetProtocol: Transport | ExtTransport;
  pattern?: string;
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
];
