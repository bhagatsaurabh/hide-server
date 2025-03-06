import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { hostname } from "node:os";
import { EurekaOptions } from "./eureka.module";

@Injectable()
export class EurekaService implements OnModuleInit, OnModuleDestroy {
  private readonly INSTANCE_ID: string;
  private readonly EUREKA_URL: string;
  private heartbeatInterval: NodeJS.Timeout;

  constructor(private readonly options: EurekaOptions) {
    this.INSTANCE_ID = `${hostname()}:${this.options.serviceName.toLowerCase()}`;
    this.EUREKA_URL = `http://${this.options.host}:${this.options.port}/eureka/v2/apps`;
  }

  async onModuleInit() {
    console.log(`Eureka service: ${this.options.host}:${this.options.port}`);
    await this.registerWithEureka();
    this.heartbeatInterval = setInterval(
      () => void this.sendHeartbeat(),
      30 * 1000
    );

    process.on(
      "SIGINT",
      () =>
        void (async () => {
          await this.deregisterFromEureka();
          process.exit(0);
        })()
    );
    process.on(
      "SIGTERM",
      () =>
        void (async () => {
          await this.deregisterFromEureka();
          process.exit(0);
        })()
    );
  }
  async onModuleDestroy() {
    await this.deregisterFromEureka();
    clearInterval(this.heartbeatInterval);
  }

  private async registerWithEureka() {
    const instance = {
      instanceId: this.INSTANCE_ID,
      hostName: this.options.serviceName,
      app: this.options.serviceName.toUpperCase(),
      ipAddr: this.options.serviceName,
      vipAddress: this.options.serviceName.toUpperCase(),
      secureVipAddress: this.options.serviceName.toUpperCase(),
      status: "UP",
      port: { $: this.options.servicePort },
      homePageUrl: `http://${this.options.serviceName}:${this.options.servicePort}/`,
      healthCheckUrl: `http://${this.options.serviceName}:${this.options.servicePort}/api/health`,
      dataCenterInfo: {
        "@class": "com.netflix.appinfo.InstanceInfo$DefaultDataCenterInfo",
        name: "MyOwn",
      },
    };

    try {
      const response = await fetch(
        `${this.EUREKA_URL}/${this.options.serviceName}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({ instance }),
        }
      );

      console.log(
        `${response.status} Registered ${this.options.serviceName} with Eureka`
      );
    } catch (error) {
      console.error(`❌ Failed to register with Eureka:`, error);
    }
  }
  private async sendHeartbeat() {
    try {
      await fetch(
        `${this.EUREKA_URL}/${this.options.serviceName}/${this.INSTANCE_ID}`,
        {
          method: "PUT",
        }
      );
    } catch (error) {
      console.error(`❌ Failed to send heartbeat:`, error);
    }
  }
  private async deregisterFromEureka() {
    console.log("De-registering with Eureka server");
    try {
      const response = await fetch(
        `${this.EUREKA_URL}/${this.options.serviceName}/${this.INSTANCE_ID}`,
        {
          method: "DELETE",
        }
      );

      console.log(`${response.status} Deregistered from Eureka`);
    } catch (error) {
      console.error(`❌ Failed to deregister:`, error);
    }
  }
  async getService(serviceName: string) {
    try {
      const response = await fetch(`${this.EUREKA_URL}/${serviceName}`, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
      });

      console.log(`${response.status}`);
      const data = (await response.json()) as {
        application: {
          instance: Array<{ ipAddr: string; port: { $: number } }>;
        };
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
