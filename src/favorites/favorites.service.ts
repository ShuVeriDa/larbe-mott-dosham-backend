import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "src/prisma.service";

@Injectable()
export class FavoritesService {
  constructor(private readonly prisma: PrismaService) {}

  async getAll(userId: string) {
    return this.prisma.userFavorite.findMany({
      where: { userId },
      include: {
        entry: {
          select: {
            id: true,
            word: true,
            wordAccented: true,
            partOfSpeech: true,
            nounClass: true,
            cefrLevel: true,
            domain: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async toggle(userId: string, entryId: number) {
    const entry = await this.prisma.unifiedEntry.findUnique({
      where: { id: entryId },
    });
    if (!entry) throw new NotFoundException(`Entry #${entryId} not found`);

    const existing = await this.prisma.userFavorite.findUnique({
      where: { userId_entryId: { userId, entryId } },
    });

    if (existing) {
      await this.prisma.userFavorite.delete({ where: { id: existing.id } });
      return { favorited: false, entryId };
    }

    await this.prisma.userFavorite.create({ data: { userId, entryId } });
    return { favorited: true, entryId };
  }

  async check(userId: string, entryId: number) {
    const existing = await this.prisma.userFavorite.findUnique({
      where: { userId_entryId: { userId, entryId } },
    });
    return { favorited: !!existing, entryId };
  }
}
