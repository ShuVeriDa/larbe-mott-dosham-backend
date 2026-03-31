import { Module } from "@nestjs/common";
import { DictionaryService } from "./dictionary.service";
import { DeclensionService } from "./declension.service";
import { DictionaryController } from "./dictionary.controller";

@Module({
  controllers: [DictionaryController],
  providers: [DictionaryService, DeclensionService],
})
export class DictionaryModule {}
