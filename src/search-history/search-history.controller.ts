import {
  Controller,
  Delete,
  Get,
  Query,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Auth } from "src/auth/decorators/auth.decorator";
import { User } from "src/user/decorators/user.decorator";
import { SearchHistoryService } from "./search-history.service";

@ApiTags("search-history")
@Controller("search-history")
@Auth()
@ApiBearerAuth()
export class SearchHistoryController {
  constructor(private readonly searchHistoryService: SearchHistoryService) {}

  @Get()
  @ApiOperation({ summary: "Get recent search history" })
  getRecent(
    @User("id") userId: string,
    @Query("limit") limit?: number,
  ) {
    return this.searchHistoryService.getRecent(userId, limit ? Number(limit) : 20);
  }

  @Delete()
  @ApiOperation({ summary: "Clear all search history" })
  clear(@User("id") userId: string) {
    return this.searchHistoryService.clear(userId);
  }
}
