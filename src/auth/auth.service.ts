import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { hash, verify } from "argon2";
import { Response } from "express";
import { PrismaService } from "src/prisma.service";
import { UserService } from "src/user/user.service";
import { CreateUserDto } from "src/user/dto/create-user.dto";
import { LoginDto } from "src/user/dto/login.dto";

@Injectable()
export class AuthService {
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
    return { user, ...tokens };
  }

  async register(dto: CreateUserDto) {
    const existingByUsername = await this.userService.getByUserName(
      dto.username,
    );
    const existingByEmail = await this.userService.getByEmail(dto.email);

    if (existingByUsername)
      throw new ConflictException("User with this username already exists");
    if (existingByEmail)
      throw new ConflictException("User with this email already exists");

    const createdUser = await this.userService.create(dto);
    const { password, hashedRefreshToken, ...user } = createdUser;

    const tokens = await this.issueTokens(user.id);
    await this.updateRefreshTokenHash(user.id, tokens.refreshToken);
    return { user, ...tokens };
  }

  async recordSession(
    userId: string,
    ipAddress?: string,
    userAgent?: string,
  ) {
    await this.prisma.userSession.create({
      data: { userId, ipAddress: ipAddress ?? null, userAgent: userAgent ?? null },
    });
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
    if (!user) throw new NotFoundException("User not found");

    const isValid = await verify(user.password, dto.password);
    if (!isValid) throw new UnauthorizedException("Invalid password");

    const { password, hashedRefreshToken, ...safeUser } = user;
    return safeUser;
  }

  private shouldUseSecureCookies(): boolean {
    if (this.configService.get("NODE_ENV") === "production") return true;

    const domain = this.configService.get<string>("DOMAIN");
    if (domain && domain !== "localhost" && domain !== "127.0.0.1")
      return true;

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
