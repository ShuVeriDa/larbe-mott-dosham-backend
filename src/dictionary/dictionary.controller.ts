import { Controller, Get, Param, Query } from "@nestjs/common";
import { DictionaryService } from "./dictionary.service";
import { DeclensionService } from "./declension.service";
import { SearchEntryDto } from "./dto/search-entry.dto";

@Controller("dictionary")
export class DictionaryController {
  constructor(
    private readonly dictionaryService: DictionaryService,
    private readonly declensionService: DeclensionService,
  ) {}

  // GET /dictionary/search?q=бала&limit=20&offset=0
  @Get("search")
  search(@Query() dto: SearchEntryDto) {
    return this.dictionaryService.search(dto);
  }

  // GET /dictionary/lookup/бала
  @Get("lookup/:word")
  lookup(@Param("word") word: string) {
    return this.dictionaryService.lookup(word);
  }

  // GET /dictionary/declension/стаг — полная парадигма склонения
  @Get("declension/:word")
  declension(@Param("word") word: string) {
    return this.declensionService.getParadigm(word);
  }

  // GET /dictionary/lemmatize/стагана — найти начальную форму
  @Get("lemmatize/:form")
  lemmatize(@Param("form") form: string) {
    return this.declensionService.lemmatize(form);
  }

  // GET /dictionary/stats
  @Get("stats")
  stats() {
    return this.dictionaryService.stats();
  }
}
