import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Redis from "ioredis";

@Injectable()
export class RedisService extends Redis implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private warned = false;

  constructor(configService: ConfigService) {
    const url =
      configService.get<string>("REDIS_URL") ?? "redis://localhost:6379";

    super(url, {
      // Не блокирует команды до соединения — они встают в очередь
      lazyConnect: false,
      // Переподключение с нарастающей задержкой (макс 30 сек)
      retryStrategy: (times) => Math.min(times * 1000, 30_000),
      // Не фейлить команды в очереди при отключении — ждать reconnect
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });

    // Без этого обработчика ioredis выбрасывает "Unhandled error event"
    // и NestJS падает на старте если Redis недоступен
    this.on("error", (err: Error) => {
      if (!this.warned) {
        this.warned = true;
        this.logger.warn(
          `Redis недоступен (${err.message}) — переподключение в фоне`,
        );
      }
    });

    this.on("connect", () => {
      this.warned = false;
      this.logger.log("Redis подключён");
    });
  }

  async onModuleDestroy() {
    await this.quit();
  }
}
