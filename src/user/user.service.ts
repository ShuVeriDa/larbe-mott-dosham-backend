import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { hash, verify } from "argon2";
import { PrismaService } from "src/prisma.service";
import { CreateUserDto } from "./dto/create-user.dto";
import { UpdateUserDto } from "./dto/update-user.dto";
import { UpdateProfileDto } from "./dto/update-profile.dto";
import { ChangePasswordDto } from "./dto/change-password.dto";
import { UpdatePreferencesDto } from "./dto/update-preferences.dto";

@Injectable()
export class UserService {
  constructor(private readonly prisma: PrismaService) {}

  async getUserById(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException("User not found");

    const { password: _password, hashedRefreshToken: _hrt, ...safeUser } = user;
    return safeUser;
  }

  async getByEmail(email: string) {
    return this.prisma.user.findFirst({ where: { email } });
  }

  async getByUserName(username: string) {
    return this.prisma.user.findFirst({ where: { username } });
  }

  async create(dto: CreateUserDto) {
    try {
      return await this.prisma.user.create({
        data: {
          email: dto.email,
          password: await hash(dto.password),
          name: dto.name,
          username: dto.username,
        },
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2002"
      ) {
        throw new ConflictException(
          "User with this email or username already exists",
        );
      }
      throw e;
    }
  }

  /** @deprecated используется только в auth — оставлен для совместимости */
  async updateUser(dto: UpdateUserDto, userId: string) {
    const user = await this.getUserById(userId);
    const password = dto.password ? await hash(dto.password) : undefined;

    try {
      const updated = await this.prisma.user.update({
        where: { id: user.id },
        data: {
          email: dto.email,
          password,
          name: dto.name,
          username: dto.username,
        },
      });
      const { password: _, hashedRefreshToken: __, ...safeUser } = updated;
      return safeUser;
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2002"
      ) {
        throw new ConflictException("Email or username is already taken");
      }
      throw e;
    }
  }

  // ─── Профиль ────────────────────────────────────────────────────────────────

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    try {
      const updated = await this.prisma.user.update({
        where: { id: userId },
        data: {
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.username !== undefined && { username: dto.username }),
          ...(dto.email !== undefined && { email: dto.email }),
        },
      });
      const { password: _, hashedRefreshToken: __, ...safeUser } = updated;
      return safeUser;
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2002"
      ) {
        throw new ConflictException("Email or username is already taken");
      }
      throw e;
    }
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException("User not found");

    const isValid = await verify(user.password, dto.currentPassword);
    if (!isValid) throw new UnauthorizedException("Current password is incorrect");

    await this.prisma.user.update({
      where: { id: userId },
      data: { password: await hash(dto.newPassword) },
    });

    return { message: "Password changed successfully" };
  }

  async updatePreferences(userId: string, dto: UpdatePreferencesDto) {
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.prefSaveHistory !== undefined && { prefSaveHistory: dto.prefSaveHistory }),
        ...(dto.prefShowExamples !== undefined && { prefShowExamples: dto.prefShowExamples }),
        ...(dto.prefCompactView !== undefined && { prefCompactView: dto.prefCompactView }),
        ...(dto.prefTheme !== undefined && { prefTheme: dto.prefTheme }),
        ...(dto.prefLanguage !== undefined && { prefLanguage: dto.prefLanguage }),
        ...(dto.prefHotkeys !== undefined && { prefHotkeys: dto.prefHotkeys }),
        ...(dto.prefShowGrammar !== undefined && { prefShowGrammar: dto.prefShowGrammar }),
        ...(dto.prefPerPage !== undefined && { prefPerPage: dto.prefPerPage }),
        ...(dto.prefDefaultCefr !== undefined && { prefDefaultCefr: dto.prefDefaultCefr }),
        ...(dto.prefPublicProfile !== undefined && { prefPublicProfile: dto.prefPublicProfile }),
        ...(dto.prefPublicFavorites !== undefined && { prefPublicFavorites: dto.prefPublicFavorites }),
      },
    });
    const { password: _, hashedRefreshToken: __, ...safeUser } = updated;
    return safeUser;
  }

  async updateAvatar(userId: string, avatarUrl: string) {
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { avatarUrl },
    });
    const { password: _, hashedRefreshToken: __, ...safeUser } = updated;
    return safeUser;
  }

  async deleteAccount(userId: string) {
    // Каскадное удаление через onDelete: Cascade в схеме
    await this.prisma.user.delete({ where: { id: userId } });
    return { message: "Account deleted" };
  }

  async getStats(userId: string) {
    const [favoritesCount, searchCount, suggestionsCount] = await Promise.all([
      this.prisma.userFavorite.count({ where: { userId } }),
      this.prisma.searchHistory.count({ where: { userId } }),
      this.prisma.suggestion.count({ where: { userId } }),
    ]);

    return { favoritesCount, searchCount, suggestionsCount };
  }
}
