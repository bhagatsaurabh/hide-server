import { Injectable, OnModuleInit } from '@nestjs/common';
import { Client } from 'typesense';

@Injectable()
export class TypesenseService implements OnModuleInit {
  client: Client;

  onModuleInit() {
    this.client = new Client({
      apiKey: process.env.TYPESENSE_APIKEY!,
      nodes: [
        {
          host: process.env.TYPESENSE_HOST!,
          port: parseInt(process.env.TYPESENSE_PORT!),
          protocol: process.env.TYPESENSE_PROTOCOL!,
        },
      ],
    });
  }
}
