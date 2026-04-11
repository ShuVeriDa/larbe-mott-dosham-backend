import { type MiddlewareConsumer, Module, type NestModule } from "@nestjs/common";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { WinstonModule } from "nest-winston";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { ThrottlerStorageRedisService } from "@nest-lab/throttler-storage-redis";
import { correlationIdMiddleware } from "./common/middleware/correlation-id.middleware";
import { AllExceptionsFilter } from "./common/filters/all-exceptions.filter";
import { LoggingInterceptor } from "./common/interceptors/logging.interceptor";
import { createWinstonOptions } from "./logger/logger.config";
import { PrismaModule } from "./database/prisma.module";
import { RedisModule } from "./redis/redis.module";
import { RedisService } from "./redis/redis.service";
import { DictionaryModule } from "./dictionary/dictionary.module";
import { MergeModule } from "./merge/merge.module";
import { AuthModule } from "./auth/auth.module";
import { UserModule } from "./user/user.module";
import { FavoritesModule } from "./favorites/favorites.module";
import { SearchHistoryModule } from "./search-history/search-history.module";
import { SuggestionsModule } from "./suggestions/suggestions.module";
import { AdminModule } from "./admin/admin.module";
import { HealthModule } from "./health/health.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    WinstonModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        createWinstonOptions(config.get("NODE_ENV")),
    }),
    RedisModule,
    ThrottlerModule.forRootAsync({
      inject: [RedisService],
      useFactory: (redis: RedisService) => ({
        throttlers: [{ ttl: 60000, limit: 100 }],
        storage: new ThrottlerStorageRedisService(redis),
      }),
    }),
    PrismaModule,
    AuthModule,
    UserModule,
    DictionaryModule,
    MergeModule,
    FavoritesModule,
    SearchHistoryModule,
    SuggestionsModule,
    AdminModule,
    HealthModule,
  ],
  controllers: [],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(correlationIdMiddleware).forRoutes("*");
  }
}
