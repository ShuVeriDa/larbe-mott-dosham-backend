import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Throttle } from "@nestjs/throttler";
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import { UserService } from "src/user/user.service";
import * as express from "express";
import { User } from "src/user/decorators/user.decorator";
import { LoginDto } from "src/user/dto/login.dto";
import { CreateUserDto } from "src/user/dto/create-user.dto";
import { AuthService } from "./auth.service";
import { Auth } from "./decorators/auth.decorator";

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
    private readonly userService: UserService,
  ) {}

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @HttpCode(200)
  @Post("login")
  @ApiOperation({ summary: "Authenticate user with credentials" })
  @ApiNotFoundResponse({ description: "User not found" })
  @ApiUnauthorizedResponse({ description: "Invalid password" })
  @ApiOkResponse({ description: "Access and refresh tokens issued" })
  async login(
    @Body() dto: LoginDto,
    @Req() req: express.Request,
    @Res({ passthrough: true }) res: express.Response,
  ) {
    const { refreshToken, ...response } = await this.authService.login(dto);
    this.authService.addRefreshTokenResponse(res, refreshToken);
    await this.authService.recordSession(
      response.user.id,
      req.ip,
      req.headers["user-agent"],
    );
    return response;
  }

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @HttpCode(200)
  @Post("register")
  @ApiConflictResponse({ description: "User already exists" })
  @ApiOperation({ summary: "Register a new user account" })
  @ApiCreatedResponse({ description: "User registered successfully" })
  async register(
    @Body() dto: CreateUserDto,
    @Req() req: express.Request,
    @Res({ passthrough: true }) res: express.Response,
  ) {
    const { refreshToken, ...response } = await this.authService.register(dto);
    this.authService.addRefreshTokenResponse(res, refreshToken);
    await this.authService.recordSession(
      response.user.id,
      req.ip,
      req.headers["user-agent"],
    );
    return response;
  }

  @HttpCode(200)
  @Post("login/access-token")
  @ApiOperation({ summary: "Refresh access token using refresh cookie" })
  @ApiOkResponse({ description: "New tokens issued" })
  async getNewTokens(
    @Req() req: express.Request,
    @Res({ passthrough: true }) res: express.Response,
  ) {
    const refreshTokenName =
      this.configService.getOrThrow<string>("REFRESH_TOKEN_NAME");
    const refreshTokenFromCookies = req.cookies[refreshTokenName];

    if (!refreshTokenFromCookies) {
      this.authService.removeRefreshTokenFromResponse(res);
      throw new UnauthorizedException("Refresh token not passed");
    }

    const { refreshToken, ...response } = await this.authService.getNewTokens(
      refreshTokenFromCookies,
    );
    this.authService.addRefreshTokenResponse(res, refreshToken);
    return response;
  }

  @Auth()
  @Get("me")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get current authenticated user profile" })
  @ApiOkResponse({ description: "Current user data" })
  @ApiUnauthorizedResponse({ description: "Not authenticated" })
  me(@User("id") userId: string) {
    return this.userService.getUserById(userId);
  }

  @Auth()
  @HttpCode(200)
  @Post("logout")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Logout and invalidate refresh token" })
  @ApiOkResponse({ description: "Logged out successfully" })
  async logout(
    @User("id") userId: string,
    @Res({ passthrough: true }) res: express.Response,
  ) {
    await this.authService.logout(userId);
    this.authService.removeRefreshTokenFromResponse(res);
    return true;
  }
}
