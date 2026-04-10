import { Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Auth } from "src/auth/decorators/auth.decorator";
import { User } from "src/user/decorators/user.decorator";
import { FavoritesService } from "./favorites.service";

@ApiTags("favorites")
@Controller("favorites")
@Auth()
@ApiBearerAuth()
export class FavoritesController {
  constructor(private readonly favoritesService: FavoritesService) {}

  @Get()
  @ApiOperation({ summary: "Get all favorited entries" })
  getAll(@User("id") userId: string) {
    return this.favoritesService.getAll(userId);
  }

  @Post(":entryId")
  @ApiOperation({ summary: "Toggle favorite (add/remove)" })
  toggle(
    @User("id") userId: string,
    @Param("entryId", ParseIntPipe) entryId: number,
  ) {
    return this.favoritesService.toggle(userId, entryId);
  }

  @Get(":entryId/check")
  @ApiOperation({ summary: "Check if entry is favorited" })
  check(
    @User("id") userId: string,
    @Param("entryId", ParseIntPipe) entryId: number,
  ) {
    return this.favoritesService.check(userId, entryId);
  }

  @Delete()
  @HttpCode(200)
  @ApiOperation({ summary: "Clear all favorites" })
  clearAll(@User("id") userId: string) {
    return this.favoritesService.clearAll(userId);
  }
}
