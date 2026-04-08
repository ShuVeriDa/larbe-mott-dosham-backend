import { Injectable } from "@nestjs/common";
import { PrismaService } from "src/prisma.service";

@Injectable()
export class SearchHistoryService {
  constructor(private readonly prisma: PrismaService) {}

  async record(userId: string, query: string, lang?: string) {
    await this.prisma.searchHistory.create({
      data: { userId, query, lang },
    });
  }

  async getRecent(userId: string, limit = 20) {
    return this.prisma.searchHistory.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { id: true, query: true, lang: true, createdAt: true },
    });
  }

  async clear(userId: string) {
    const { count } = await this.prisma.searchHistory.deleteMany({
      where: { userId },
    });
    return { cleared: count };
  }
}
