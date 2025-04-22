import { Transport } from '@nestjs/microservices';
import { ExtTransport } from 'hide-common';

type Rule = {
  sourceProtocol: Transport | ExtTransport;
  targetProtocol: Transport | ExtTransport;
  pattern?: string;
};
type Actions = Record<string, Partial<Record<'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'OPTIONS', Rule>>>;
type Rules = Record<string, Actions>;

export const rules: Rules = {
  user: {
    register: {
      POST: {
        sourceProtocol: ExtTransport.HTTP,
        targetProtocol: ExtTransport.HTTP,
      },
    },
  },
  filesystem: {
    open: {
      GET: {
        sourceProtocol: ExtTransport.HTTP,
        targetProtocol: Transport.REDIS,
        pattern: 'fs:open',
      },
    },
    close: {
      POST: {
        sourceProtocol: ExtTransport.HTTP,
        targetProtocol: Transport.REDIS,
        pattern: 'fs:close',
      },
    },
  },
  workspace: {
    all: {
      GET: {
        sourceProtocol: ExtTransport.HTTP,
        targetProtocol: ExtTransport.HTTP,
      },
    },
  },
  provisioner: {
    provision: {
      POST: {
        sourceProtocol: ExtTransport.HTTP,
        targetProtocol: ExtTransport.HTTP,
      },
    },
  },
};
