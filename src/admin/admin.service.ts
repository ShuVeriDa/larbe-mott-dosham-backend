import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, RoleName } from "@prisma/client";
import * as crypto from "crypto";
import { PrismaService } from "src/prisma.service";
import { MergeService } from "src/merge/merge.service";

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mergeService: MergeService,
  ) {}

  // -----------------------------------------------------------------------
  // API Keys
  // -----------------------------------------------------------------------

  async listApiKeys() {
    return this.prisma.apiKey.findMany({
      orderBy: { createdAt: "desc" },
    });
  }

  async createApiKey(name: string, role: RoleName = RoleName.USER) {
    const key = `dosham-${role.toLowerCase()}-${crypto.randomBytes(16).toString("hex")}`;
    return this.prisma.apiKey.create({ data: { key, name, role } });
  }

  async updateApiKey(
    id: string,
    data: { name?: string; isActive?: boolean; role?: RoleName },
  ) {
    return this.prisma.apiKey.update({ where: { id }, data });
  }

  async deleteApiKey(id: string) {
    await this.prisma.apiKey.delete({ where: { id } });
    return { deleted: true };
  }

  // -----------------------------------------------------------------------
  // Users
  // -----------------------------------------------------------------------

  async listUsers() {
    return this.prisma.user.findMany({
      select: {
        id: true,
        email: true,
        username: true,
        name: true,
        status: true,
        createdAt: true,
        roles: {
          select: { role: { select: { name: true } } },
        },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async assignRole(userId: string, roleName: RoleName) {
    const role = await this.prisma.role.findUnique({
      where: { name: roleName },
    });
    if (!role) throw new NotFoundException(`Role ${roleName} not found`);

    await this.prisma.userRoleAssignment.upsert({
      where: { userId_roleId: { userId, roleId: role.id } },
      update: {},
      create: { userId, roleId: role.id },
    });
    return { userId, role: roleName, assigned: true };
  }

  async removeRole(userId: string, roleName: RoleName) {
    const role = await this.prisma.role.findUnique({
      where: { name: roleName },
    });
    if (!role) throw new NotFoundException(`Role ${roleName} not found`);

    await this.prisma.userRoleAssignment.deleteMany({
      where: { userId, roleId: role.id },
    });
    return { userId, role: roleName, removed: true };
  }

  async setUserStatus(userId: string, status: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { status },
      select: { id: true, username: true, status: true },
    });
  }

  // -----------------------------------------------------------------------
  // Pipeline
  // -----------------------------------------------------------------------

  async runParse(slug: string) {
    if (slug === "all") return this.mergeService.parseAll();
    return this.mergeService.parseOne(slug);
  }

  async runUnifyStep(slug: string) {
    return this.mergeService.unifyStep(slug);
  }

  async runLoad() {
    return this.mergeService.load();
  }

  async runImprove() {
    return this.mergeService.improve();
  }

  async runRollback(step: number) {
    return this.mergeService.rollback(step);
  }

  async runReset() {
    return this.mergeService.resetSteps();
  }

  // -----------------------------------------------------------------------
  // Data Quality
  // -----------------------------------------------------------------------

  async qualityStats() {
    const [total, noMeanings, noClass, noPos, noExamples, neologisms] =
      await Promise.all([
        this.prisma.unifiedEntry.count(),
        this.prisma.$queryRaw<[{ count: bigint }]>`
          SELECT COUNT(*) as count FROM "UnifiedEntry"
          WHERE jsonb_array_length(meanings::jsonb) = 0`,
        this.prisma.$queryRaw<[{ count: bigint }]>`
          SELECT COUNT(*) as count FROM "UnifiedEntry"
          WHERE "nounClass" IS NULL AND "partOfSpeech" = 'сущ.'`,
        this.prisma.$queryRaw<[{ count: bigint }]>`
          SELECT COUNT(*) as count FROM "UnifiedEntry"
          WHERE "partOfSpeech" IS NULL`,
        this.prisma.$queryRaw<[{ count: bigint }]>`
          SELECT COUNT(*) as count FROM "UnifiedEntry"
          WHERE NOT meanings::text LIKE '%examples%'`,
        this.prisma.unifiedEntry.count({
          where: { entryType: "neologism" },
        }),
      ]);

    return {
      total,
      noMeanings: Number(noMeanings[0].count),
      nounsWithoutClass: Number(noClass[0].count),
      noPartOfSpeech: Number(noPos[0].count),
      noExamples: Number(noExamples[0].count),
      neologisms,
    };
  }

  async findProblems(type?: string, limit = 50) {
    const select = Prisma.sql`SELECT id, word, "partOfSpeech", "nounClass", "entryType", sources FROM "UnifiedEntry"`;

    switch (type) {
      case "no-meanings":
        return this.prisma.$queryRaw`${select}
          WHERE jsonb_array_length(meanings::jsonb) = 0
          LIMIT ${limit}`;
      case "no-class":
        return this.prisma.$queryRaw`${select}
          WHERE "nounClass" IS NULL AND "partOfSpeech" = 'сущ.'
          LIMIT ${limit}`;
      case "no-pos":
        return this.prisma.$queryRaw`${select}
          WHERE "partOfSpeech" IS NULL
          LIMIT ${limit}`;
      case "no-examples":
        return this.prisma.$queryRaw`${select}
          WHERE NOT meanings::text LIKE '%examples%'
          LIMIT ${limit}`;
      default:
        return this.prisma.$queryRaw`${select}
          WHERE "partOfSpeech" IS NULL
            OR ("nounClass" IS NULL AND "partOfSpeech" = 'сущ.')
          LIMIT ${limit}`;
    }
  }

  // -----------------------------------------------------------------------
  // Audit Log
  // -----------------------------------------------------------------------

  async getEntryEditHistory(entryId: number) {
    return this.prisma.entryEditLog.findMany({
      where: { entryId },
      include: {
        user: { select: { id: true, username: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async getRecentEdits(limit = 50) {
    return this.prisma.entryEditLog.findMany({
      include: {
        user: { select: { id: true, username: true, name: true } },
        entry: { select: { id: true, word: true } },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  }
}
