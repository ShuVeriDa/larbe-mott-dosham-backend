import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import * as express from "express";
import { User } from "src/user/decorators/user.decorator";
import { CreateUserDto } from "src/user/dto/create-user.dto";
import { LoginDto } from "src/user/dto/login.dto";
import { UserService } from "src/user/user.service";
import { AuthService } from "./auth.service";
import { Auth } from "./decorators/auth.decorator";
import { ForgotPasswordDto } from "./dto/forgot-password.dto";
import { ResetPasswordPhoneDto } from "./dto/reset-password-phone.dto";
import { ResetPasswordDto } from "./dto/reset-password.dto";

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

  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @HttpCode(200)
  @Post("forgot-password")
  @ApiOperation({
    summary: "Request password reset",
    description:
      "Provide `email` OR `phone` (not both at once). " +
      "An email with a reset link/token will be sent to the email address; an SMS with a 6-digit OTP code will be sent to the phone.",
  })
  @ApiBody({ type: ForgotPasswordDto })
  @ApiOkResponse({
    description: "Email/SMS sent (token/OTP included in response in dev mode only)",
  })
  @ApiBadRequestResponse({ description: "Neither email nor phone provided" })
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    if (dto.email) {
      return this.authService.forgotPasswordByEmail(dto.email);
    }
    if (dto.phone) {
      return this.authService.forgotPasswordByPhone(dto.phone);
    }
    throw new BadRequestException("Provide email or phone number");
  }

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @HttpCode(200)
  @Post("reset-password")
  @ApiOperation({ summary: "Reset password using token from email" })
  @ApiOkResponse({ description: "Password changed successfully" })
  @ApiBadRequestResponse({ description: "Token is invalid or expired" })
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto.token, dto.newPassword);
  }

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @HttpCode(200)
  @Post("reset-password/phone")
  @ApiOperation({ summary: "Reset password using OTP code from SMS" })
  @ApiOkResponse({ description: "Password changed successfully" })
  @ApiBadRequestResponse({ description: "Invalid or expired OTP code" })
  resetPasswordByPhone(@Body() dto: ResetPasswordPhoneDto) {
    return this.authService.resetPasswordByPhone(
      dto.phone,
      dto.code,
      dto.newPassword,
    );
  }

  // ─── Sessions ──────────────────────────────────────────────────────────────

  @Auth()
  @Get("sessions")
  @ApiBearerAuth()
  @ApiOperation({ summary: "List active sessions for current user" })
  @ApiOkResponse({ description: "Array of sessions with isCurrent flag" })
  getSessions(@User("id") userId: string, @Req() req: express.Request) {
    const currentSessionId = (req as { sessionId?: string }).sessionId;
    return this.authService.getSessions(userId, currentSessionId);
  }

  @Auth()
  @Delete("sessions/:id")
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiParam({ name: "id", description: "Session ID" })
  @ApiOperation({ summary: "Revoke a specific session" })
  @ApiOkResponse({ description: "Session revoked" })
  @ApiForbiddenResponse({ description: "Cannot revoke the current session" })
  @ApiNotFoundResponse({ description: "Session not found" })
  async revokeSession(
    @User("id") userId: string,
    @Param("id") sessionId: string,
    @Req() req: express.Request,
  ) {
    const currentSessionId = (req as { sessionId?: string }).sessionId;
    try {
      return await this.authService.revokeSession(
        userId,
        sessionId,
        currentSessionId,
      );
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("Cannot revoke current"))
        throw new ForbiddenException("Cannot revoke the current session");
      throw new NotFoundException("Session not found or already revoked");
    }
  }

  @Auth()
  @Delete("sessions")
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Revoke all sessions except the current one" })
  @ApiOkResponse({ description: "{ count: number }" })
  revokeAllSessions(@User("id") userId: string, @Req() req: express.Request) {
    const currentSessionId = (req as { sessionId?: string }).sessionId;
    return this.authService.revokeAllOtherSessions(userId, currentSessionId);
  }
}
