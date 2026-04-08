import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { hash } from "argon2";
import { PrismaService } from "src/prisma.service";
import { CreateUserDto } from "./dto/create-user.dto";
import { UpdateUserDto } from "./dto/update-user.dto";

@Injectable()
export class UserService {
  constructor(private readonly prisma: PrismaService) {}

  async getUserById(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException("User not found");

    const { password, hashedRefreshToken, ...safeUser } = user;
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
}
