import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Patch,
  Res,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import type { Response } from "express";
import { Auth } from "src/auth/decorators/auth.decorator";
import { AuthService } from "src/auth/auth.service";
import { User } from "./decorators/user.decorator";
import { UserService } from "./user.service";
import { UpdateProfileDto } from "./dto/update-profile.dto";
import { ChangePasswordDto } from "./dto/change-password.dto";
import { UpdatePreferencesDto } from "./dto/update-preferences.dto";
import { DeleteAccountDto } from "./dto/delete-account.dto";

@ApiTags("users")
@ApiBearerAuth()
@Auth()
@Controller("users")
export class UserController {
  constructor(
    private readonly userService: UserService,
    private readonly authService: AuthService,
  ) {}

  @Patch("me")
  @ApiOperation({ summary: "Update name, username or email" })
  @ApiOkResponse({ description: "Updated profile" })
  @ApiUnauthorizedResponse()
  updateProfile(
    @User("id") userId: string,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.userService.updateProfile(userId, dto);
  }

  @Patch("me/password")
  @HttpCode(200)
  @ApiOperation({ summary: "Change password (for authenticated user)" })
  @ApiOkResponse({ description: "Password changed successfully" })
  changePassword(
    @User("id") userId: string,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.userService.changePassword(userId, dto);
  }

  @Patch("me/preferences")
  @ApiOperation({ summary: "Update preferences (history, examples, compact view)" })
  @ApiOkResponse({ description: "Updated preferences" })
  updatePreferences(
    @User("id") userId: string,
    @Body() dto: UpdatePreferencesDto,
  ) {
    return this.userService.updatePreferences(userId, dto);
  }

  @Get("me/stats")
  @ApiOperation({ summary: "Profile statistics: favorites, searches, suggestions" })
  @ApiOkResponse({
    description: "{ favoritesCount, searchCount, suggestionsCount }",
  })
  getStats(@User("id") userId: string) {
    return this.userService.getStats(userId);
  }

  @Delete("me")
  @HttpCode(200)
  @ApiOperation({ summary: 'Delete account. Body: { confirmation: "delete" }' })
  @ApiOkResponse({ description: "Account deleted" })
  async deleteAccount(
    @User("id") userId: string,
    @Body() dto: DeleteAccountDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.authService.removeRefreshTokenFromResponse(res);
    return this.userService.deleteAccount(userId);
  }
}
