import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { hostname } from 'node:os';

@Injectable()
export class EurekaService implements OnModuleInit, OnModuleDestroy {
  private readonly EUREKA_HOST = process.env.EUREKA_HOST || 'localhost';
  private readonly EUREKA_PORT = process.env.EUREKA_PORT || '8761';
  private readonly SERVICE_NAME = 'API-GATEWAY';
  private readonly SERVICE_PORT = process.env.PORT ?? 3001;
  private readonly INSTANCE_ID = `${hostname()}:${this.SERVICE_NAME.toLowerCase()}`;
  private readonly EUREKA_URL = `http://${this.EUREKA_HOST}:${this.EUREKA_PORT}/eureka/v2/apps/${this.SERVICE_NAME}`;
  private heartbeatInterval: NodeJS.Timeout;

  async onModuleInit() {
    await this.registerWithEureka();
    this.heartbeatInterval = setInterval(
      () => void this.sendHeartbeat(),
      30 * 1000,
    );

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
      app: this.SERVICE_NAME.toUpperCase(), // Eureka requires uppercase service names
      ipAddr: '127.0.0.1',
      vipAddress: this.SERVICE_NAME.toUpperCase(),
      secureVipAddress: this.SERVICE_NAME.toUpperCase(),
      status: 'UP',
      port: { $: this.SERVICE_PORT, '@enabled': true },
      homePageUrl: `http://localhost:${this.SERVICE_PORT}/`,
      healthCheckUrl: `http://localhost:${this.SERVICE_PORT}/health`,
      dataCenterInfo: {
        '@class': 'com.netflix.appinfo.InstanceInfo$DefaultDataCenterInfo',
        name: 'MyOwn', // Required by Eureka
      },
    };

    try {
      const response = await fetch(this.EUREKA_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ instance }),
      });

      if (!response.ok) throw new Error(`HTTP Error ${response.status}`);
      console.log(`✅ Registered ${this.SERVICE_NAME} with Eureka`);
    } catch (error) {
      console.error(`❌ Failed to register with Eureka:`, error);
    }
  }

  private async sendHeartbeat() {
    try {
      const response = await fetch(`${this.EUREKA_URL}/${this.INSTANCE_ID}`, {
        method: 'PUT',
      });

      if (!response.ok) throw new Error(`HTTP Error ${response.status}`);
      console.log(`💓 Sent heartbeat to Eureka`);
    } catch (error) {
      console.error(`❌ Failed to send heartbeat:`, error);
    }
  }

  private async deregisterFromEureka() {
    console.log('De-registering with Eureka server');
    try {
      const response = await fetch(`${this.EUREKA_URL}/${this.INSTANCE_ID}`, {
        method: 'DELETE',
      });

      if (!response.ok) throw new Error(`HTTP Error ${response.status}`);
      console.log(`🛑 Deregistered from Eureka`);
    } catch (error) {
      console.error(`❌ Failed to deregister:`, error);
    }
  }
}
