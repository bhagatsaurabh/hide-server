import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

import { hostname } from 'node:os';

@Injectable()
export class EurekaService implements OnModuleInit, OnModuleDestroy {
  private readonly EUREKA_HOST = process.env.EUREKA_HOST || 'localhost';
  private readonly EUREKA_PORT = process.env.EUREKA_PORT || '8761';
  private readonly SERVICE_NAME = 'API-GATEWAY';
  private readonly SERVICE_PORT = process.env.PORT ?? 3001;
  private readonly INSTANCE_ID = `${hostname()}:${this.SERVICE_NAME.toLowerCase()}`;
  private readonly EUREKA_URL = `http://${this.EUREKA_HOST}:${this.EUREKA_PORT}/eureka/v2/apps`;
  private heartbeatInterval: NodeJS.Timeout;

  async onModuleInit() {
    await this.registerWithEureka();
    this.heartbeatInterval = setInterval(() => void this.sendHeartbeat(), 30 * 1000);

    process.on(
      'SIGINT',
      () =>
        void (async () => {
          await this.deregisterFromEureka();
          process.exit(0);
        })(),
    );

    process.on(
      'SIGTERM',
      () =>
        void (async () => {
          await this.deregisterFromEureka();
          process.exit(0);
        })(),
    );
  }

  async onModuleDestroy() {
    await this.deregisterFromEureka();
    clearInterval(this.heartbeatInterval);
  }

  private async registerWithEureka() {
    const instance = {
      instanceId: this.INSTANCE_ID,
      hostName: 'localhost',
      app: this.SERVICE_NAME.toUpperCase(),
      ipAddr: '127.0.0.1',
      vipAddress: this.SERVICE_NAME.toUpperCase(),
      secureVipAddress: this.SERVICE_NAME.toUpperCase(),
      status: 'UP',
      port: { $: this.SERVICE_PORT },
      homePageUrl: `http://localhost:${this.SERVICE_PORT}/`,
      healthCheckUrl: `http://localhost:${this.SERVICE_PORT}/api/health`,
      dataCenterInfo: {
        '@class': 'com.netflix.appinfo.InstanceInfo$DefaultDataCenterInfo',
        name: 'MyOwn',
      },
    };

    try {
      const response = await fetch(`${this.EUREKA_URL}/${this.SERVICE_NAME}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ instance }),
      });

      console.log(`${response.status} Registered ${this.SERVICE_NAME} with Eureka`);
    } catch (error) {
      console.error(`❌ Failed to register with Eureka:`, error);
    }
  }

  private async sendHeartbeat() {
    try {
      await fetch(`${this.EUREKA_URL}/${this.SERVICE_NAME}/${this.INSTANCE_ID}`, {
        method: 'PUT',
      });
    } catch (error) {
      console.error(`❌ Failed to send heartbeat:`, error);
    }
  }

  private async deregisterFromEureka() {
    console.log('De-registering with Eureka server');
    try {
      const response = await fetch(`${this.EUREKA_URL}/${this.SERVICE_NAME}/${this.INSTANCE_ID}`, {
        method: 'DELETE',
      });

      console.log(`${response.status} Deregistered from Eureka`);
    } catch (error) {
      console.error(`❌ Failed to deregister:`, error);
    }
  }

  async getService(serviceName: string) {
    try {
      const response = await fetch(`${this.EUREKA_URL}/${serviceName}`, {
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
      });

      console.log(`${response.status}`);
      const data = (await response.json()) as {
        application: { instance: Array<{ ipAddr: string; port: { $: number } }> };
      };
      const instances = data.application.instance;
      if (!instances || instances.length === 0) {
        console.log(`${response.status} No instance found `);
      }

      const { ipAddr, port } = instances[0];
      return `http://${ipAddr}:${port.$}`;
    } catch (error) {
      console.error(`Error fetching service instance: ${error}`);
    }
  }
}
