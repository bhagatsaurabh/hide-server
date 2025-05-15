import {
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { RmqOptions } from "@nestjs/microservices";
import * as amqp from "amqp-connection-manager";
import { ConfirmChannel } from "amqplib";
import { from, Observable } from "rxjs";

@Injectable()
export class RmqService implements OnModuleInit, OnModuleDestroy {
  private connection: amqp.AmqpConnectionManager;
  private channelWrapper: amqp.ChannelWrapper;
  private defaultExchange = "hide-default";

  constructor(
    @Inject("RMQ_CONFIG") private readonly config: RmqOptions["options"]
  ) {}

  async onModuleInit() {
    const config = this.config!;
    this.connection = amqp.connect(config.urls);
    this.channelWrapper = this.connection.createChannel({
      setup: async (channel: ConfirmChannel) => {
        await channel.assertExchange(
          this.defaultExchange,
          config.exchangeType || "topic",
          { durable: !!config.queueOptions?.durable }
        );
      },
    });

    this.connection.on("connect", () => {
      console.log("RabbitMQ connected");
    });

    this.connection.on("disconnect", (_err) => {
      console.log("RabbitMQ disconnected");
    });
  }

  private getChannelWrapper(): amqp.ChannelWrapper {
    return this.channelWrapper;
  }

  async onModuleDestroy() {
    await this.channelWrapper?.close();
    await this.connection?.close();
  }

  private async _send<T = any>(routingKey: string, message: T) {
    const channelWrapper = this.getChannelWrapper();
    const msgBuffer = Buffer.from(JSON.stringify(message));

    try {
      await channelWrapper.publish(this.defaultExchange, routingKey, msgBuffer);
      console.log(
        `Published message to exchange "${this.defaultExchange}" with routing key "${routingKey}"`
      );
    } catch (error) {
      console.error("Failed to publish message", error);
      // TODO: Retry & re-throw
    }
  }
  send<T = any>(routingKey: string, message: T): Observable<void> {
    return from(this._send(routingKey, message));
  }
}
