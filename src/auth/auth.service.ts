import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { hash, verify } from "argon2";
import { randomBytes } from "crypto";
import { Response } from "express";
import { PrismaService } from "src/prisma.service";
import { UserService } from "src/user/user.service";
import { CreateUserDto } from "src/user/dto/create-user.dto";
import { LoginDto } from "src/user/dto/login.dto";

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private jwt: JwtService,
    private userService: UserService,
    private readonly configService: ConfigService,
  ) {}

  async login(dto: LoginDto) {
    const user = await this.validateUser(dto);
    const tokens = await this.issueTokens(user.id);
    await this.updateRefreshTokenHash(user.id, tokens.refreshToken);
    this.logger.log(`Login successful: ${user.username} (${user.id})`);
    return { user, ...tokens };
  }

  async register(dto: CreateUserDto) {
    const [existingByUsername, existingByEmail] = await Promise.all([
      this.userService.getByUserName(dto.username),
      this.userService.getByEmail(dto.email),
    ]);

    if (existingByUsername)
      throw new ConflictException("User with this username already exists");
    if (existingByEmail)
      throw new ConflictException("User with this email already exists");

    const createdUser = await this.userService.create(dto);
    const { password, hashedRefreshToken, ...user } = createdUser;

    const tokens = await this.issueTokens(user.id);
    await this.updateRefreshTokenHash(user.id, tokens.refreshToken);
    this.logger.log(`Registration: ${user.username} (${user.id})`);
    return { user, ...tokens };
  }

  async recordSession(userId: string, ipAddress?: string, userAgent?: string) {
    const session = await this.prisma.userSession.create({
      data: {
        userId,
        ipAddress: ipAddress ?? null,
        userAgent: userAgent ?? null,
      },
    });
    return session.id;
  }

  async getSessions(userId: string, currentSessionId?: string) {
    const sessions = await this.prisma.userSession.findMany({
      where: { userId, revokedAt: null },
      orderBy: { lastActiveAt: "desc" },
    });

    return sessions.map((s) => ({
      id: s.id,
      userAgent: s.userAgent,
      ipAddress: s.ipAddress,
      createdAt: s.createdAt,
      lastActiveAt: s.lastActiveAt,
      isCurrent: s.id === currentSessionId,
    }));
  }

  async revokeSession(userId: string, sessionId: string, currentSessionId?: string) {
    const session = await this.prisma.userSession.findFirst({
      where: { id: sessionId, userId, revokedAt: null },
    });

    if (!session) throw new Error("Session not found or already revoked");
    if (session.id === currentSessionId) throw new Error("Cannot revoke current session");

    await this.prisma.userSession.update({
      where: { id: sessionId },
      data: { revokedAt: new Date() },
    });

    return { message: "Сессия завершена" };
  }

  async revokeAllOtherSessions(userId: string, currentSessionId?: string) {
    const result = await this.prisma.userSession.updateMany({
      where: {
        userId,
        revokedAt: null,
        ...(currentSessionId && { NOT: { id: currentSessionId } }),
      },
      data: { revokedAt: new Date() },
    });

    return { message: "Все другие сессии завершены", count: result.count };
  }

  addRefreshTokenResponse(res: Response, refreshToken: string) {
    const expiresIn = new Date();
    const expireDays = Number(
      this.configService.get("EXPIRE_DAY_REFRESH_TOKEN") ?? 7,
    );
    expiresIn.setDate(expiresIn.getDate() + expireDays);

    const refreshTokenName =
      this.configService.getOrThrow<string>("REFRESH_TOKEN_NAME");
    const domain = this.configService.get<string>("DOMAIN") || undefined;
    const secure = this.shouldUseSecureCookies();
    const sameSite = secure ? ("none" as const) : ("lax" as const);

    res.cookie(refreshTokenName, refreshToken, {
      httpOnly: true,
      domain,
      expires: expiresIn,
      secure,
      sameSite,
    });
  }

  removeRefreshTokenFromResponse(res: Response) {
    const refreshTokenName =
      this.configService.getOrThrow<string>("REFRESH_TOKEN_NAME");
    const domain = this.configService.get<string>("DOMAIN") || undefined;
    const secure = this.shouldUseSecureCookies();
    const sameSite = secure ? ("none" as const) : ("lax" as const);

    res.cookie(refreshTokenName, "", {
      httpOnly: true,
      domain,
      expires: new Date(0),
      secure,
      sameSite,
    });
  }

  async getNewTokens(refreshToken: string) {
    const result = await this.jwt.verifyAsync(refreshToken, {
      secret: this.configService.getOrThrow("JWT_REFRESH_SECRET"),
    });

    if (!result) throw new UnauthorizedException("Invalid refresh token");
    if (result.type !== "refresh")
      throw new UnauthorizedException("Invalid token type");

    const user = await this.prisma.user.findUnique({
      where: { id: result.id },
    });
    if (!user) throw new NotFoundException("User not found");
    if (!user.hashedRefreshToken)
      throw new UnauthorizedException("Refresh token revoked");

    const isValid = await verify(user.hashedRefreshToken, refreshToken);
    if (!isValid) throw new UnauthorizedException("Invalid refresh token");

    const tokens = await this.issueTokens(user.id);
    await this.updateRefreshTokenHash(user.id, tokens.refreshToken);

    const { password, hashedRefreshToken: _, ...safeUser } = user;
    return { user: safeUser, ...tokens };
  }

  async logout(userId: string) {
    await this.clearRefreshTokenHash(userId);
    this.logger.log(`Logout: ${userId}`);
  }

  async forgotPassword(email: string) {
    const user = await this.prisma.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
    });

    // Не раскрываем факт существования пользователя
    if (!user) {
      return { message: "Если аккаунт с таким email существует, мы отправили ссылку для сброса пароля" };
    }

    // Инвалидируем старые неиспользованные токены
    await this.prisma.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });

    const rawToken = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 час

    await this.prisma.passwordResetToken.create({
      data: { userId: user.id, token: rawToken, expiresAt },
    });

    this.logger.log(`Password reset requested for user ${user.id}`);

    // В production здесь будет отправка email.
    // Пока возвращаем токен напрямую — для разработки и тестирования frontend.
    const isDev = this.configService.get("NODE_ENV") !== "production";
    return {
      message: "Если аккаунт с таким email существует, мы отправили ссылку для сброса пароля",
      ...(isDev && { resetToken: rawToken }),
    };
  }

  async resetPassword(token: string, newPassword: string) {
    const record = await this.prisma.passwordResetToken.findUnique({
      where: { token },
    });

    if (!record || record.usedAt) {
      throw new BadRequestException("Токен недействителен или уже использован");
    }

    if (record.expiresAt < new Date()) {
      throw new BadRequestException("Срок действия токена истёк");
    }

    const hashedPassword = await hash(newPassword);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: record.userId },
        data: { password: hashedPassword, hashedRefreshToken: null },
      }),
      this.prisma.passwordResetToken.update({
        where: { token },
        data: { usedAt: new Date() },
      }),
    ]);

    this.logger.log(`Password reset completed for user ${record.userId}`);
    return { message: "Пароль успешно изменён" };
  }

  // -----------------------------------------------------------------------

  private async validateUser(dto: LoginDto) {
    const user = await this.prisma.user.findFirst({
      where: {
        OR: [
          { username: dto.username },
          { email: { equals: dto.username, mode: "insensitive" } },
        ],
      },
    });
    if (!user) {
      this.logger.warn(`Login failed: unknown user "${dto.username}"`);
      throw new NotFoundException("User not found");
    }

    const isValid = await verify(user.password, dto.password);
    if (!isValid) {
      this.logger.warn(
        `Login failed: wrong password for "${dto.username}" (${user.id})`,
      );
      throw new UnauthorizedException("Invalid password");
    }

    const { password, hashedRefreshToken, ...safeUser } = user;
    return safeUser;
  }

  private shouldUseSecureCookies(): boolean {
    if (this.configService.get("NODE_ENV") === "production") return true;

    const domain = this.configService.get<string>("DOMAIN");
    if (domain && domain !== "localhost" && domain !== "127.0.0.1") return true;

    return false;
  }

  private async issueTokens(userId: string) {
    const payload = { sub: userId, id: userId };

    const accessToken = await this.jwt.signAsync(
      { ...payload, type: "access" },
      {
        secret: this.configService.getOrThrow("JWT_ACCESS_SECRET"),
        expiresIn: this.configService.getOrThrow("ACCESS_TOKEN_EXPIRES_IN"),
      },
    );

    const refreshToken = await this.jwt.signAsync(
      { ...payload, type: "refresh" },
      {
        secret: this.configService.getOrThrow("JWT_REFRESH_SECRET"),
        expiresIn: this.configService.getOrThrow("REFRESH_TOKEN_EXPIRES_IN"),
      },
    );

    return { accessToken, refreshToken };
  }

  private async updateRefreshTokenHash(userId: string, refreshToken: string) {
    const hashed = await hash(refreshToken);
    await this.prisma.user.update({
      where: { id: userId },
      data: { hashedRefreshToken: hashed },
    });
  }

  private async clearRefreshTokenHash(userId: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { hashedRefreshToken: null },
    });
  }
}
