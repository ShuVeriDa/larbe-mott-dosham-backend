import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { PrismaModule } from "./database/prisma.module";
import { DictionaryModule } from "./dictionary/dictionary.module";
import { MergeModule } from "./merge/merge.module";

@Module({
  imports: [
    ConfigModule.forRoot(),
    PrismaModule,
    DictionaryModule,
    MergeModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
