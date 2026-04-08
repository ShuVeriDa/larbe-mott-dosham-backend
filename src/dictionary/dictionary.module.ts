import { Module } from "@nestjs/common";
import { DictionaryService } from "./dictionary.service";
import { DeclensionService } from "./declension.service";
import { ConjugationService } from "./conjugation.service";
import { DictionaryController } from "./dictionary.controller";
import { AuthModule } from "src/auth/auth.module";

@Module({
  imports: [AuthModule],
  controllers: [DictionaryController],
  providers: [DictionaryService, DeclensionService, ConjugationService],
})
export class DictionaryModule {}
