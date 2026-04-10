import {
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  Param,
  ParseIntPipe,
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
  @ApiOperation({ summary: "Get search history with pagination" })
  getRecent(
    @User("id") userId: string,
    @Query("limit", new DefaultValuePipe(100), ParseIntPipe) limit: number,
    @Query("offset", new DefaultValuePipe(0), ParseIntPipe) offset: number,
  ) {
    return this.searchHistoryService.getRecent(userId, limit, offset);
  }

  @Delete()
  @ApiOperation({ summary: "Clear all search history" })
  clear(@User("id") userId: string) {
    return this.searchHistoryService.clear(userId);
  }

  @Delete(":id")
  @ApiOperation({ summary: "Delete a single search history record" })
  deleteOne(@User("id") userId: string, @Param("id") id: string) {
    return this.searchHistoryService.deleteOne(userId, id);
  }
}
