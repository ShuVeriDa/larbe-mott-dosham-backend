import { Controller, Get, Param, Query } from "@nestjs/common";
import { DictionaryService } from "./dictionary.service";
import { SearchEntryDto } from "./dto/search-entry.dto";

@Controller("dictionary")
export class DictionaryController {
  constructor(private readonly dictionaryService: DictionaryService) {}

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

  // GET /dictionary/stats
  @Get("stats")
  stats() {
    return this.dictionaryService.stats();
  }
}
