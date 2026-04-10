import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from "@nestjs/common";
import { PrismaService } from "src/prisma.service";

@Injectable()
export class SearchHistoryService {
  constructor(private readonly prisma: PrismaService) {}

  async record(userId: string, query: string, lang?: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { prefSaveHistory: true },
    });
    if (!user || !user.prefSaveHistory) return;

    await this.prisma.searchHistory.create({
      data: { userId, query, lang },
    });
  }

  async getRecent(userId: string, limit = 100, offset = 0) {
    const [items, total] = await Promise.all([
      this.prisma.searchHistory.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
        select: { id: true, query: true, lang: true, createdAt: true },
      }),
      this.prisma.searchHistory.count({ where: { userId } }),
    ]);
    return { items, total };
  }

  async deleteOne(userId: string, id: string) {
    const record = await this.prisma.searchHistory.findUnique({
      where: { id },
      select: { userId: true },
    });
    if (!record) throw new NotFoundException("Record not found");
    if (record.userId !== userId) throw new ForbiddenException();
    await this.prisma.searchHistory.delete({ where: { id } });
    return { deleted: true };
  }

  async clear(userId: string) {
    const { count } = await this.prisma.searchHistory.deleteMany({
      where: { userId },
    });
    return { cleared: count };
  }
}
