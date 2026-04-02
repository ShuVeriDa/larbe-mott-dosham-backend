import {
  type OnModuleDestroy,
  type OnModuleInit,
  Injectable,
} from "@nestjs/common";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    const connectionString = process.env["DATABASE_URL"];
    if (!connectionString) {
      throw new Error("DATABASE_URL environment variable is not set");
    }

    const adapter = new PrismaPg({
      connectionString: process.env.DATABASE_URL!,
    });
    super({
      adapter,
      log:
        process.env.NODE_ENV === "development"
          ? ["query", "error", "warn"]
          : ["error"],
    });
  }
  async onModuleInit() {
    await this.$connect();
    // pg_trgm нужен для функции similarity() в поиске
    await this.$executeRawUnsafe(
      `CREATE EXTENSION IF NOT EXISTS pg_trgm`,
    );
  }

  async onModuleDestroy() {
    // Закрываем соединение при завершении
    await this.$disconnect();
  }
}
