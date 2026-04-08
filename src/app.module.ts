import { type MiddlewareConsumer, Module, type NestModule } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ConfigModule } from "@nestjs/config";
import { CorrelationIdMiddleware } from "./common/middleware/correlation-id.middleware";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { ThrottlerStorageRedisService } from "@nest-lab/throttler-storage-redis";
import { PrismaModule } from "./database/prisma.module";
import { RedisModule } from "./redis/redis.module";
import { DictionaryModule } from "./dictionary/dictionary.module";
import { MergeModule } from "./merge/merge.module";
import { AuthModule } from "./auth/auth.module";
import { UserModule } from "./user/user.module";
import { FavoritesModule } from "./favorites/favorites.module";
import { SearchHistoryModule } from "./search-history/search-history.module";
import { SuggestionsModule } from "./suggestions/suggestions.module";
import { AdminModule } from "./admin/admin.module";
import { HealthModule } from "./health/health.module";
import { RedisService } from "./redis/redis.service";

@Module({
  imports: [
    ConfigModule.forRoot(),
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
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CorrelationIdMiddleware).forRoutes("*");
  }
}
