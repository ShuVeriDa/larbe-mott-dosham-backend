import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, RoleName } from "@prisma/client";
import * as crypto from "crypto";
import { normalizeWord } from "src/common/utils/normalize_util";
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

  async getUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
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
    });
    if (!user) throw new NotFoundException(`User #${userId} not found`);
    return user;
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

  async runImproveEntries(ids: number[]) {
    return this.mergeService.improveEntries(ids);
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
  // Entries: stats / bulk delete / export
  // -----------------------------------------------------------------------

  async entriesStats() {
    type StatsRow = {
      total: bigint;
      noun: bigint;
      verb: bigint;
      adj: bigint;
      adv: bigint;
      other: bigint;
      updated_today: bigint;
    };

    const [row] = await this.prisma.$queryRaw<StatsRow[]>`
      SELECT
        COUNT(*)                                                                           AS total,
        COUNT(*) FILTER (WHERE "partOfSpeech" ILIKE '%сущ%' OR "partOfSpeech" = 'noun')  AS noun,
        COUNT(*) FILTER (WHERE "partOfSpeech" ILIKE '%гл%'  OR "partOfSpeech" = 'verb')  AS verb,
        COUNT(*) FILTER (WHERE "partOfSpeech" ILIKE '%прил%' OR "partOfSpeech" = 'adj')  AS adj,
        COUNT(*) FILTER (WHERE "partOfSpeech" ILIKE '%нар%' OR "partOfSpeech" = 'adv')   AS adv,
        COUNT(*) FILTER (WHERE NOT (
          "partOfSpeech" ILIKE '%сущ%' OR "partOfSpeech" = 'noun'
          OR "partOfSpeech" ILIKE '%гл%'  OR "partOfSpeech" = 'verb'
          OR "partOfSpeech" ILIKE '%прил%' OR "partOfSpeech" = 'adj'
          OR "partOfSpeech" ILIKE '%нар%' OR "partOfSpeech" = 'adv'
        ))                                                                                 AS other,
        COUNT(*) FILTER (WHERE "updatedAt" >= CURRENT_DATE)                               AS updated_today
      FROM "UnifiedEntry"
    `;

    return {
      total: Number(row.total),
      byPos: {
        noun: Number(row.noun),
        verb: Number(row.verb),
        adj: Number(row.adj),
        adv: Number(row.adv),
        other: Number(row.other),
      },
      sourcesCount: 14,
      updatedToday: Number(row.updated_today),
    };
  }

  async bulkDeleteEntries(ids: number[]) {
    const existing = await this.prisma.unifiedEntry.findMany({
      where: { id: { in: ids } },
      select: { id: true },
    });
    const existingIds = new Set(existing.map((e) => e.id));

    const toDelete = ids.filter((id) => existingIds.has(id));
    const notFound = ids.filter((id) => !existingIds.has(id));

    if (toDelete.length > 0) {
      await this.prisma.unifiedEntry.deleteMany({ where: { id: { in: toDelete } } });
    }

    const results = [
      ...toDelete.map((id) => ({ id, success: true })),
      ...notFound.map((id) => ({ id, success: false, error: `Entry #${id} not found` })),
    ];

    return {
      total: ids.length,
      deleted: toDelete.length,
      failed: notFound.length,
      results,
    };
  }

  async exportEntries(params: {
    q?: string;
    pos?: string;
    source?: string;
    cefr?: string[];
    nounClass?: string;
  }) {
    const { q, pos, source, cefr, nounClass } = params;

    const conditions: Prisma.Sql[] = [];

    if (q && q.trim()) {
      const normalized = normalizeWord(q.trim());
      conditions.push(
        Prisma.sql`(e."wordNormalized" ILIKE ${"%" + normalized + "%"} OR e."meanings"::text ILIKE ${"%" + q + "%"})`,
      );
    }
    if (pos) conditions.push(Prisma.sql`e."partOfSpeech" = ${pos}`);
    if (source) conditions.push(Prisma.sql`${source} = ANY(e.sources::text[])`);
    if (cefr && cefr.length > 0) conditions.push(Prisma.sql`e."cefrLevel" = ANY(${cefr}::text[])`);
    if (nounClass) conditions.push(Prisma.sql`e."nounClass" = ${nounClass}`);

    const whereClause =
      conditions.length > 0 ? conditions.reduce((acc, c) => Prisma.sql`${acc} AND ${c}`) : Prisma.sql`TRUE`;

    type ExportRow = {
      id: number;
      word: string;
      partOfSpeech: string | null;
      nounClass: string | null;
      cefrLevel: string | null;
      entryType: string | null;
      sources: string[];
      domain: string | null;
      meanings: unknown;
      updatedAt: Date;
      createdAt: Date;
    };

    return this.prisma.$queryRaw<ExportRow[]>`
      SELECT
        e.id, e.word, e."partOfSpeech", e."nounClass",
        e."cefrLevel", e."entryType", e.sources, e.domain,
        e.meanings, e."updatedAt", e."createdAt"
      FROM "UnifiedEntry" e
      WHERE ${whereClause}
      ORDER BY e.id ASC
    `;
  }

  async listEntries(params: {
    pos?: string;
    nounClass?: string;
    source?: string;
    cefr?: string;
    limit?: number;
  }) {
    const { pos, nounClass, source, cefr, limit = 100 } = params;

    const conditions: Prisma.Sql[] = [];

    if (pos) conditions.push(Prisma.sql`"partOfSpeech" = ${pos}`);
    if (nounClass) conditions.push(Prisma.sql`"nounClass" = ${nounClass}`);
    if (source) conditions.push(Prisma.sql`${source} = ANY(sources::text[])`);
    if (cefr) conditions.push(Prisma.sql`"cefrLevel" = ${cefr}`);

    const whereClause =
      conditions.length > 0
        ? conditions.reduce((acc, c) => Prisma.sql`${acc} AND ${c}`)
        : Prisma.sql`TRUE`;

    const safeLimit = Math.min(Math.max(1, limit), 100);

    type ListRow = {
      id: number;
      word: string;
      partOfSpeech: string | null;
      nounClass: string | null;
      cefrLevel: string | null;
      entryType: string | null;
    };

    const [data, totalResult] = await Promise.all([
      this.prisma.$queryRaw<ListRow[]>`
        SELECT id, word, "partOfSpeech", "nounClass", "cefrLevel", "entryType"
        FROM "UnifiedEntry"
        WHERE ${whereClause}
        ORDER BY id ASC
        LIMIT ${safeLimit}`,
      this.prisma.$queryRaw<[{ count: bigint }]>`
        SELECT COUNT(*) AS count FROM "UnifiedEntry" WHERE ${whereClause}`,
    ]);

    return { data, total: Number(totalResult[0].count) };
  }

  async batchFetchEntries(ids: number[]) {
    type BatchRow = {
      id: number;
      word: string;
      partOfSpeech: string | null;
      nounClass: string | null;
      cefrLevel: string | null;
      entryType: string | null;
      domain: string | null;
      styleLabel: string | null;
      latinName: string | null;
      nounClassPlural: string | null;
      partOfSpeechNah: string | null;
    };

    return this.prisma.$queryRaw<BatchRow[]>`
      SELECT
        id, word, "partOfSpeech", "nounClass", "cefrLevel", "entryType",
        domain, "styleLabel", "latinName", "nounClassPlural", "partOfSpeechNah"
      FROM "UnifiedEntry"
      WHERE id = ANY(${ids}::int[])
      ORDER BY id ASC`;
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
      noClass: Number(noClass[0].count),
      noPartOfSpeech: Number(noPos[0].count),
      noExamples: Number(noExamples[0].count),
      neologisms,
      problemsUnique: problemsUniqueNum,
      cleanEntries: total - problemsUniqueNum,
      pendingSuggestions,
    };
  }

  private buildOrderBySql(sortBy?: string, sortDir?: string): Prisma.Sql {
    const dir = sortDir === "asc" ? Prisma.raw("ASC") : Prisma.raw("DESC");
    switch (sortBy) {
      case "word":
        return Prisma.sql`ORDER BY word ${dir}`;
      case "source":
        return Prisma.sql`ORDER BY sources[1] ${dir}`;
      case "problems":
        return Prisma.sql`ORDER BY (
          (jsonb_array_length(meanings::jsonb) = 0)::int +
          ("partOfSpeech" IS NULL)::int +
          ("nounClass" IS NULL AND "partOfSpeech" = 'сущ.')::int +
          (NOT meanings::text LIKE '%examples%')::int
        ) ${dir}`;
      default:
        return Prisma.sql`ORDER BY "updatedAt" ${dir}`;
    }
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
      meanings?: unknown;
      flag_no_meanings: boolean;
      flag_no_pos: boolean;
      flag_no_class: boolean;
      flag_no_examples: boolean;
    }[],
    includeMeanings = false,
  ) {
    return rows.map(({ flag_no_meanings, flag_no_pos, flag_no_class, flag_no_examples, meanings, ...row }) => ({
      ...row,
      ...(includeMeanings ? { meanings } : {}),
      problems: [
        flag_no_meanings && "no-meanings",
        flag_no_pos && "no-pos",
        flag_no_class && "no-class",
        flag_no_examples && "no-examples",
      ].filter(Boolean) as string[],
    }));
  }

  async findProblems(
    type?: string,
    limit = 50,
    page = 1,
    q?: string,
    source?: string,
    sortBy?: string,
    sortDir?: string,
    include?: string,
  ) {
    const offset = (page - 1) * limit;
    const filter = this.buildProblemsFilter(type, q, source);
    const orderBy = this.buildOrderBySql(sortBy, sortDir);
    const includeMeanings = include === "meanings";
    const meaningsSql = includeMeanings ? Prisma.sql`, meanings` : Prisma.empty;

    type ProblemsRow = {
      id: number;
      word: string;
      partOfSpeech: string | null;
      nounClass: string | null;
      entryType: string;
      sources: string[];
      updatedAt: Date;
      meanings?: unknown;
      flag_no_meanings: boolean;
      flag_no_pos: boolean;
      flag_no_class: boolean;
      flag_no_examples: boolean;
    };

    const selectSql = Prisma.sql`
      SELECT
        id, word, "partOfSpeech", "nounClass", "entryType", sources, "updatedAt"${meaningsSql},
        (jsonb_array_length(meanings::jsonb) = 0)                       AS flag_no_meanings,
        ("partOfSpeech" IS NULL)                                         AS flag_no_pos,
        ("nounClass" IS NULL AND "partOfSpeech" = 'сущ.')               AS flag_no_class,
        (NOT meanings::text LIKE '%examples%')                          AS flag_no_examples
      FROM "UnifiedEntry"
      WHERE ${filter}`;

    const [rows, totalResult] = await Promise.all([
      this.prisma.$queryRaw<ProblemsRow[]>`${selectSql} ${orderBy} LIMIT ${limit} OFFSET ${offset}`,
      this.prisma.$queryRaw<[{ count: bigint }]>`SELECT COUNT(*) as count FROM "UnifiedEntry" WHERE ${filter}`,
    ]);

    const total = Number(totalResult[0].count);

    return {
      data: this.mapProblemRows(rows, includeMeanings),
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    };
  }

  async findProblemsForExport(type?: string, q?: string, source?: string, sortBy?: string, sortDir?: string) {
    const filter = this.buildProblemsFilter(type, q, source);
    const orderBy = this.buildOrderBySql(sortBy, sortDir);

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
      ${orderBy}`;

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

  async getAdjacentEntries(id: number): Promise<{ prevId: number | null; nextId: number | null }> {
    const [prev, next] = await Promise.all([
      this.prisma.unifiedEntry.findFirst({
        where: { id: { lt: id } },
        orderBy: { id: "desc" },
        select: { id: true },
      }),
      this.prisma.unifiedEntry.findFirst({
        where: { id: { gt: id } },
        orderBy: { id: "asc" },
        select: { id: true },
      }),
    ]);
    return { prevId: prev?.id ?? null, nextId: next?.id ?? null };
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
