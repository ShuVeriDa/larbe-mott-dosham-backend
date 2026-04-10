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

  getPipelineStatus() {
    return this.mergeService.status();
  }

  getUnifiedLog() {
    return this.mergeService.getUnifiedLog();
  }

  getParsedFiles() {
    return this.mergeService.parsedFiles();
  }

  getPipelineLog() {
    return this.mergeService.getPipelineLog();
  }

  clearPipelineLog() {
    return this.mergeService.clearPipelineLog();
  }

  async getLoadHistory(limit: number) {
    return this.prisma.loadRun.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  }

  async getImproveHistory(limit: number) {
    return this.prisma.improveRun.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  }

  // -----------------------------------------------------------------------
  // Data Quality
  // -----------------------------------------------------------------------

  async qualityStats() {
    const [total, noMeanings, noClass, noPos, noExamples, neologisms, problemsUnique, pendingSuggestions] =
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
        this.prisma.$queryRaw<[{ count: bigint }]>`
          SELECT COUNT(*) as count FROM "UnifiedEntry"
          WHERE jsonb_array_length(meanings::jsonb) = 0
            OR "partOfSpeech" IS NULL
            OR ("nounClass" IS NULL AND "partOfSpeech" = 'сущ.')
            OR NOT meanings::text LIKE '%examples%'`,
        this.prisma.suggestion.count({ where: { status: "PENDING" } }),
      ]);

    const problemsUniqueNum = Number(problemsUnique[0].count);

    return {
      total,
      noMeanings: Number(noMeanings[0].count),
      nounsWithoutClass: Number(noClass[0].count),
      noPartOfSpeech: Number(noPos[0].count),
      noExamples: Number(noExamples[0].count),
      neologisms,
      problemsUnique: problemsUniqueNum,
      cleanEntries: total - problemsUniqueNum,
      pendingSuggestions,
    };
  }

  private buildProblemsFilter(type?: string, q?: string, source?: string): Prisma.Sql {
    let typeCondition: Prisma.Sql;
    switch (type) {
      case "no-meanings":
        typeCondition = Prisma.sql`jsonb_array_length(meanings::jsonb) = 0`;
        break;
      case "no-class":
        typeCondition = Prisma.sql`"nounClass" IS NULL AND "partOfSpeech" = 'сущ.'`;
        break;
      case "no-pos":
        typeCondition = Prisma.sql`"partOfSpeech" IS NULL`;
        break;
      case "no-examples":
        typeCondition = Prisma.sql`NOT meanings::text LIKE '%examples%'`;
        break;
      default:
        typeCondition = Prisma.sql`(
          jsonb_array_length(meanings::jsonb) = 0
          OR "partOfSpeech" IS NULL
          OR ("nounClass" IS NULL AND "partOfSpeech" = 'сущ.')
          OR NOT meanings::text LIKE '%examples%'
        )`;
    }

    const qFilter = q ? Prisma.sql` AND LOWER(word) LIKE LOWER(${`%${q}%`})` : Prisma.empty;
    const srcFilter = source ? Prisma.sql` AND ${source} = ANY(sources::text[])` : Prisma.empty;

    return Prisma.sql`${typeCondition}${qFilter}${srcFilter}`;
  }

  private mapProblemRows(
    rows: {
      id: number;
      word: string;
      partOfSpeech: string | null;
      nounClass: string | null;
      entryType: string;
      sources: string[];
      updatedAt: Date;
      flag_no_meanings: boolean;
      flag_no_pos: boolean;
      flag_no_class: boolean;
      flag_no_examples: boolean;
    }[],
  ) {
    return rows.map(({ flag_no_meanings, flag_no_pos, flag_no_class, flag_no_examples, ...row }) => ({
      ...row,
      problems: [
        flag_no_meanings && "no-meanings",
        flag_no_pos && "no-pos",
        flag_no_class && "no-class",
        flag_no_examples && "no-examples",
      ].filter(Boolean) as string[],
    }));
  }

  async findProblems(type?: string, limit = 50, page = 1, q?: string, source?: string) {
    const offset = (page - 1) * limit;
    const filter = this.buildProblemsFilter(type, q, source);

    type ProblemsRow = {
      id: number;
      word: string;
      partOfSpeech: string | null;
      nounClass: string | null;
      entryType: string;
      sources: string[];
      updatedAt: Date;
      flag_no_meanings: boolean;
      flag_no_pos: boolean;
      flag_no_class: boolean;
      flag_no_examples: boolean;
    };

    const selectSql = Prisma.sql`
      SELECT
        id, word, "partOfSpeech", "nounClass", "entryType", sources, "updatedAt",
        (jsonb_array_length(meanings::jsonb) = 0)                       AS flag_no_meanings,
        ("partOfSpeech" IS NULL)                                         AS flag_no_pos,
        ("nounClass" IS NULL AND "partOfSpeech" = 'сущ.')               AS flag_no_class,
        (NOT meanings::text LIKE '%examples%')                          AS flag_no_examples
      FROM "UnifiedEntry"
      WHERE ${filter}`;

    const [rows, totalResult] = await Promise.all([
      this.prisma.$queryRaw<ProblemsRow[]>`${selectSql} ORDER BY "updatedAt" DESC LIMIT ${limit} OFFSET ${offset}`,
      this.prisma.$queryRaw<[{ count: bigint }]>`SELECT COUNT(*) as count FROM "UnifiedEntry" WHERE ${filter}`,
    ]);

    const total = Number(totalResult[0].count);

    return {
      data: this.mapProblemRows(rows),
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    };
  }

  async findProblemsForExport(type?: string, q?: string, source?: string) {
    const filter = this.buildProblemsFilter(type, q, source);

    type ProblemsRow = {
      id: number;
      word: string;
      partOfSpeech: string | null;
      nounClass: string | null;
      entryType: string;
      sources: string[];
      updatedAt: Date;
      flag_no_meanings: boolean;
      flag_no_pos: boolean;
      flag_no_class: boolean;
      flag_no_examples: boolean;
    };

    const rows = await this.prisma.$queryRaw<ProblemsRow[]>`
      SELECT
        id, word, "partOfSpeech", "nounClass", "entryType", sources, "updatedAt",
        (jsonb_array_length(meanings::jsonb) = 0)                       AS flag_no_meanings,
        ("partOfSpeech" IS NULL)                                         AS flag_no_pos,
        ("nounClass" IS NULL AND "partOfSpeech" = 'сущ.')               AS flag_no_class,
        (NOT meanings::text LIKE '%examples%')                          AS flag_no_examples
      FROM "UnifiedEntry"
      WHERE ${filter}
      ORDER BY "updatedAt" DESC`;

    return this.mapProblemRows(rows);
  }

  async qualityStatsBySource() {
    type SourceStatsRow = {
      source: string;
      total: bigint;
      ok: bigint;
      warn: bigint;
      err: bigint;
    };

    const rows = await this.prisma.$queryRaw<SourceStatsRow[]>`
      SELECT
        src AS source,
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE problems_count = 0) AS ok,
        COUNT(*) FILTER (WHERE problems_count = 1) AS warn,
        COUNT(*) FILTER (WHERE problems_count >= 2) AS err
      FROM (
        SELECT
          UNNEST(sources::text[]) AS src,
          (
            (jsonb_array_length(meanings::jsonb) = 0)::int +
            ("partOfSpeech" IS NULL)::int +
            ("nounClass" IS NULL AND "partOfSpeech" = 'сущ.')::int +
            (NOT meanings::text LIKE '%examples%')::int
          ) AS problems_count
        FROM "UnifiedEntry"
      ) t
      GROUP BY src
      ORDER BY total DESC`;

    return rows.map((row) => {
      const total = Number(row.total);
      const ok = Number(row.ok);
      const warn = Number(row.warn);
      const err = Number(row.err);
      return {
        source: row.source,
        total,
        ok,
        warn,
        err,
        okPct: total > 0 ? Math.round((ok / total) * 100) : 0,
        warnPct: total > 0 ? Math.round((warn / total) * 100) : 0,
        errPct: total > 0 ? Math.round((err / total) * 100) : 0,
      };
    });
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
