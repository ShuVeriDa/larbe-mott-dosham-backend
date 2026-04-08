import {
  type OnModuleDestroy,
  type OnModuleInit,
  Injectable,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor(private readonly configService: ConfigService) {
    const connectionString = configService.getOrThrow<string>("DATABASE_URL");
    const nodeEnv = configService.get<string>("NODE_ENV") ?? "development";

    const adapter = new PrismaPg({ connectionString });
    super({
      adapter,
      log: nodeEnv === "development" ? ["query", "error", "warn"] : ["error"],
    });
  }

  async onModuleInit() {
    await this.$connect();
    await this.$executeRaw`CREATE EXTENSION IF NOT EXISTS pg_trgm`;
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
