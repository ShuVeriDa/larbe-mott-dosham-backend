import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { PermissionCode, SuggestionStatus } from "@prisma/client";
import { Auth } from "src/auth/decorators/auth.decorator";
import { AdminPermission } from "src/auth/decorators/admin-permission.decorator";
import { User } from "src/user/decorators/user.decorator";
import { SuggestionsService } from "./suggestions.service";
import { CreateSuggestionDto } from "./dto/create-suggestion.dto";
import { ReviewSuggestionDto } from "./dto/review-suggestion.dto";

@ApiTags("suggestions")
@Controller("suggestions")
export class SuggestionsController {
  constructor(private readonly suggestionsService: SuggestionsService) {}

  /** Любой авторизованный пользователь может предложить правку */
  @Post()
  @Auth()
  @ApiBearerAuth()
  @ApiOperation({ summary: "Submit a suggestion for an entry" })
  create(@User("id") userId: string, @Body() dto: CreateSuggestionDto) {
    return this.suggestionsService.create(
      userId,
      dto.entryId,
      dto.field,
      dto.newValue,
      dto.comment,
    );
  }

  @Get("my")
  @Auth()
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get my submitted suggestions" })
  my(
    @User("id") userId: string,
    @Query("limit", new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query("offset", new DefaultValuePipe(0), ParseIntPipe) offset: number,
  ) {
    return this.suggestionsService.getMySubmissions(userId, limit, offset);
  }

  /** Admin: список всех предложений */
  @Get()
  @AdminPermission(PermissionCode.CAN_EDIT_ENTRIES)
  @ApiBearerAuth()
  @ApiOperation({ summary: "List all suggestions (admin)" })
  list(
    @Query("status") status?: string,
    @Query("limit", new DefaultValuePipe(50), ParseIntPipe) limit?: number,
    @Query("offset", new DefaultValuePipe(0), ParseIntPipe) offset?: number,
  ) {
    const s = status as SuggestionStatus | undefined;
    return this.suggestionsService.list(s, limit, offset);
  }

  /** Admin: одобрить или отклонить */
  @Post(":id/review")
  @AdminPermission(PermissionCode.CAN_EDIT_ENTRIES)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Review a suggestion (approve/reject)" })
  review(
    @Param("id") id: string,
    @User("id") reviewerId: string,
    @Body() dto: ReviewSuggestionDto,
  ) {
    return this.suggestionsService.review(
      id,
      reviewerId,
      dto.decision,
      dto.comment,
    );
  }
}
