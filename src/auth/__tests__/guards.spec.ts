import { UnauthorizedException, ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { RoleName, PermissionCode } from "@prisma/client";
import { ApiKeyGuard } from "src/common/guards/api-key.guard";
import { PermissionGuard } from "../permissions/permission.guard";

describe("ApiKeyGuard", () => {
  let guard: ApiKeyGuard;
  let prisma: any;
  let reflector: Reflector;

  const mockContext = (headers: Record<string, string> = {}) => ({
    switchToHttp: () => ({
      getRequest: () => ({ headers }),
    }),
    getHandler: () => ({}),
  });

  beforeEach(() => {
    prisma = {
      apiKey: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    reflector = new Reflector();
    guard = new ApiKeyGuard(prisma, reflector);
  });

  it("throws when no X-API-Key header", async () => {
    await expect(guard.canActivate(mockContext() as any)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it("throws for invalid key", async () => {
    prisma.apiKey.findUnique.mockResolvedValue(null);

    await expect(
      guard.canActivate(mockContext({ "x-api-key": "bad-key" }) as any),
    ).rejects.toThrow(UnauthorizedException);
  });

  it("throws for inactive key", async () => {
    prisma.apiKey.findUnique.mockResolvedValue({
      id: "k1",
      key: "valid",
      isActive: false,
      role: RoleName.USER,
    });

    await expect(
      guard.canActivate(mockContext({ "x-api-key": "valid" }) as any),
    ).rejects.toThrow(UnauthorizedException);
  });

  it("allows active key with no role restrictions", async () => {
    prisma.apiKey.findUnique.mockResolvedValue({
      id: "k1",
      key: "valid",
      isActive: true,
      role: RoleName.USER,
    });
    jest.spyOn(reflector, "get").mockReturnValue(undefined);

    const result = await guard.canActivate(
      mockContext({ "x-api-key": "valid" }) as any,
    );

    expect(result).toBe(true);
  });

  it("throws when key role does not match required roles", async () => {
    prisma.apiKey.findUnique.mockResolvedValue({
      id: "k1",
      key: "valid",
      isActive: true,
      role: RoleName.USER,
    });
    jest
      .spyOn(reflector, "get")
      .mockReturnValue([RoleName.ADMIN, RoleName.EDITOR]);

    await expect(
      guard.canActivate(mockContext({ "x-api-key": "valid" }) as any),
    ).rejects.toThrow(UnauthorizedException);
  });
});

describe("PermissionGuard", () => {
  let guard: PermissionGuard;
  let reflector: Reflector;
  let permissionsService: any;

  const mockContext = (user?: { id: string }) => ({
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
    getHandler: () => ({}),
    getClass: () => ({}),
  });

  beforeEach(() => {
    reflector = new Reflector();
    permissionsService = {
      hasPermission: jest.fn(),
    };
    guard = new PermissionGuard(reflector, permissionsService);
  });

  it("allows access when no permission required", async () => {
    jest.spyOn(reflector, "getAllAndOverride").mockReturnValue(undefined);

    const result = await guard.canActivate(mockContext() as any);

    expect(result).toBe(true);
  });

  it("throws ForbiddenException when no user", async () => {
    jest
      .spyOn(reflector, "getAllAndOverride")
      .mockReturnValue(PermissionCode.CAN_EDIT_ENTRIES);

    await expect(guard.canActivate(mockContext() as any)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it("throws ForbiddenException when user lacks permission", async () => {
    jest
      .spyOn(reflector, "getAllAndOverride")
      .mockReturnValue(PermissionCode.CAN_MANAGE_USERS);
    permissionsService.hasPermission.mockResolvedValue(false);

    await expect(
      guard.canActivate(mockContext({ id: "user-1" }) as any),
    ).rejects.toThrow(ForbiddenException);
  });

  it("allows access when user has permission", async () => {
    jest
      .spyOn(reflector, "getAllAndOverride")
      .mockReturnValue(PermissionCode.CAN_EDIT_ENTRIES);
    permissionsService.hasPermission.mockResolvedValue(true);

    const result = await guard.canActivate(
      mockContext({ id: "user-1" }) as any,
    );

    expect(result).toBe(true);
    expect(permissionsService.hasPermission).toHaveBeenCalledWith(
      "user-1",
      PermissionCode.CAN_EDIT_ENTRIES,
    );
  });
});
