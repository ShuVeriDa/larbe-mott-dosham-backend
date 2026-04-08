import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Query,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";
import { PermissionCode } from "@prisma/client";
import { AdminPermission } from "src/auth/decorators/admin-permission.decorator";
import { DictionaryService } from "./dictionary.service";
import { DeclensionService } from "./declension.service";
import { ConjugationService } from "./conjugation.service";
import { SearchEntryDto } from "./dto/search-entry.dto";
import { UpdateEntryDto, BulkUpdateEntriesDto } from "./dto/update-entry.dto";

@ApiTags("dictionary")
@Controller("dictionary")
export class DictionaryController {
  constructor(
    private readonly dictionaryService: DictionaryService,
    private readonly declensionService: DeclensionService,
    private readonly conjugationService: ConjugationService,
  ) {}

  // -----------------------------------------------------------------------
  // Публичные эндпоинты (без аутентификации)
  // -----------------------------------------------------------------------

  @Get("search")
  @ApiOperation({ summary: "Search dictionary entries" })
  search(@Query() dto: SearchEntryDto) {
    return this.dictionaryService.search(dto);
  }

  @Get("lookup/:word")
  @ApiOperation({ summary: "Lookup word by exact match" })
  lookup(@Param("word") word: string) {
    return this.dictionaryService.lookup(word);
  }

  @Get("declension/:word")
  @ApiOperation({ summary: "Get full declension paradigm" })
  declension(@Param("word") word: string) {
    return this.declensionService.getParadigm(word);
  }

  @Get("lemmatize/:form")
  @ApiOperation({ summary: "Find base form from inflected form" })
  lemmatize(@Param("form") form: string) {
    return this.declensionService.lemmatize(form);
  }

  @Get("conjugation/:word")
  @ApiOperation({
    summary: "Get verb conjugation paradigm (9 tenses, moods, participles)",
  })
  conjugation(@Param("word") word: string) {
    return this.conjugationService.getParadigm(word);
  }

  @Get("stats")
  @ApiOperation({ summary: "Dictionary statistics" })
  stats() {
    return this.dictionaryService.stats();
  }

  @Get("random")
  @ApiOperation({ summary: "Get a random word (word of the day)" })
  random(@Query("cefr") cefr?: string) {
    return this.dictionaryService.random(cefr);
  }

  @Get("phraseology")
  @ApiOperation({ summary: "Search by phraseology (idioms, expressions)" })
  phraseology(
    @Query("q") q: string,
    @Query("limit", new DefaultValuePipe(20), ParseIntPipe) limit?: number,
    @Query("offset", new DefaultValuePipe(0), ParseIntPipe) offset?: number,
  ) {
    return this.dictionaryService.phraseologySearch(q, limit, offset);
  }

  // -----------------------------------------------------------------------
  // Защищённые эндпоинты (требуют JWT + разрешение CAN_EDIT_ENTRIES)
  // -----------------------------------------------------------------------

  @Patch("bulk/update")
  @AdminPermission(PermissionCode.CAN_EDIT_ENTRIES)
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Bulk update multiple entries (up to 100 at once)",
  })
  @ApiOkResponse({ description: "Bulk update results" })
  bulkUpdate(@Body() dto: BulkUpdateEntriesDto) {
    return this.dictionaryService.bulkUpdate(dto.entries);
  }

  @Get(":id")
  @ApiOperation({ summary: "Get entry by ID" })
  getById(@Param("id", ParseIntPipe) id: number) {
    return this.dictionaryService.getById(id);
  }

  @Patch(":id")
  @AdminPermission(PermissionCode.CAN_EDIT_ENTRIES)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Update a single dictionary entry" })
  @ApiOkResponse({ description: "Entry updated" })
  update(@Param("id", ParseIntPipe) id: number, @Body() dto: UpdateEntryDto) {
    return this.dictionaryService.updateEntry(id, dto);
  }
}
