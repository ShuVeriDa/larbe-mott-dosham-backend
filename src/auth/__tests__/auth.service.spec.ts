import {
  ConflictException,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { AuthService } from "../auth.service";

// Mock argon2
jest.mock("argon2", () => ({
  hash: jest.fn().mockResolvedValue("hashed_token"),
  verify: jest.fn(),
}));
import { verify } from "argon2";
const mockVerify = verify as jest.Mock;

describe("AuthService", () => {
  let service: AuthService;
  let prisma: any;
  let jwt: any;
  let userService: any;
  let configService: any;

  beforeEach(() => {
    prisma = {
      user: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      userSession: { create: jest.fn() },
    };

    jwt = {
      signAsync: jest.fn().mockResolvedValue("mock_token"),
      verifyAsync: jest.fn(),
    };

    userService = {
      getByUserName: jest.fn(),
      getByEmail: jest.fn(),
      create: jest.fn(),
    };

    configService = {
      get: jest.fn((key: string) => {
        const map: Record<string, string> = {
          EXPIRE_DAY_REFRESH_TOKEN: "7",
          DOMAIN: "localhost",
          NODE_ENV: "development",
        };
        return map[key];
      }),
      getOrThrow: jest.fn((key: string) => {
        const map: Record<string, string> = {
          JWT_ACCESS_SECRET: "access_secret",
          JWT_REFRESH_SECRET: "refresh_secret",
          ACCESS_TOKEN_EXPIRES_IN: "1h",
          REFRESH_TOKEN_EXPIRES_IN: "7d",
          REFRESH_TOKEN_NAME: "refreshToken",
        };
        return map[key];
      }),
    };

    service = new AuthService(prisma, jwt, userService, configService);
  });

  describe("login", () => {
    const mockUser = {
      id: "user-1",
      username: "testuser",
      email: "test@test.com",
      password: "hashed_pass",
      hashedRefreshToken: null,
      name: "Test",
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    it("returns user and tokens on valid credentials", async () => {
      prisma.user.findFirst.mockResolvedValue(mockUser);
      mockVerify.mockResolvedValue(true);

      const result = await service.login({
        username: "testuser",
        password: "pass123",
      });

      expect(result.user).toBeDefined();
      expect(result.user.id).toBe("user-1");
      expect(result.accessToken).toBe("mock_token");
      expect(result.refreshToken).toBe("mock_token");
      expect(result.user).not.toHaveProperty("password");
      expect(result.user).not.toHaveProperty("hashedRefreshToken");
    });

    it("throws NotFoundException for unknown user", async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      await expect(
        service.login({ username: "noone", password: "x" }),
      ).rejects.toThrow(NotFoundException);
    });

    it("throws UnauthorizedException for wrong password", async () => {
      prisma.user.findFirst.mockResolvedValue(mockUser);
      mockVerify.mockResolvedValue(false);

      await expect(
        service.login({ username: "testuser", password: "wrong" }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe("register", () => {
    const dto = {
      username: "newuser",
      email: "new@test.com",
      password: "pass123",
      name: "New User",
    };

    it("creates user and returns tokens", async () => {
      userService.getByUserName.mockResolvedValue(null);
      userService.getByEmail.mockResolvedValue(null);
      userService.create.mockResolvedValue({
        id: "user-2",
        ...dto,
        password: "hashed",
        hashedRefreshToken: null,
        status: "active",
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.register(dto);

      expect(result.user.id).toBe("user-2");
      expect(result.accessToken).toBeDefined();
      expect(result.user).not.toHaveProperty("password");
    });

    it("throws ConflictException if username exists", async () => {
      userService.getByUserName.mockResolvedValue({ id: "existing" });
      userService.getByEmail.mockResolvedValue(null);

      await expect(service.register(dto)).rejects.toThrow(ConflictException);
    });

    it("throws ConflictException if email exists", async () => {
      userService.getByUserName.mockResolvedValue(null);
      userService.getByEmail.mockResolvedValue({ id: "existing" });

      await expect(service.register(dto)).rejects.toThrow(ConflictException);
    });
  });

  describe("logout", () => {
    it("clears refresh token hash", async () => {
      prisma.user.update.mockResolvedValue({});

      await service.logout("user-1");

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: "user-1" },
        data: { hashedRefreshToken: null },
      });
    });
  });

  describe("getNewTokens", () => {
    it("throws UnauthorizedException for non-refresh token type", async () => {
      jwt.verifyAsync.mockResolvedValue({ id: "user-1", type: "access" });

      await expect(service.getNewTokens("some_token")).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it("throws UnauthorizedException when refresh token is revoked", async () => {
      jwt.verifyAsync.mockResolvedValue({ id: "user-1", type: "refresh" });
      prisma.user.findUnique.mockResolvedValue({
        id: "user-1",
        hashedRefreshToken: null,
      });

      await expect(service.getNewTokens("some_token")).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe("addRefreshTokenResponse", () => {
    it("sets httpOnly cookie with correct options", () => {
      const res = { cookie: jest.fn() } as any;

      service.addRefreshTokenResponse(res, "token123");

      expect(res.cookie).toHaveBeenCalledWith(
        "refreshToken",
        "token123",
        expect.objectContaining({
          httpOnly: true,
          domain: "localhost",
          secure: false,
          sameSite: "lax",
        }),
      );
    });
  });
});
