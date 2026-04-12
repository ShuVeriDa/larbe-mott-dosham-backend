import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, RoleName, SuggestionStatus } from "@prisma/client";
import * as crypto from "crypto";
import { normalizeWord } from "src/common/utils/normalize_util";
import { PrismaService } from "src/prisma.service";
import { MergeService } from "src/merge/merge.service";
import { RedisService } from "src/redis/redis.service";

const DICT_CACHE_PREFIX = "dict";

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mergeService: MergeService,
    private readonly redis: RedisService,
  ) {}

  // -----------------------------------------------------------------------
  // API Keys
  // -----------------------------------------------------------------------

  private getApiKeyPrefix(key: string): string {
    return key.slice(0, 16) + "\u2026";
  }

  private getApiKeyMask(key: string): string {
    return key.slice(0, 16) + "\u2026" + key.slice(-4);
  }

  async listApiKeys() {
    const keys = await this.prisma.apiKey.findMany({
      orderBy: { createdAt: "desc" },
    });
    return keys.map(({ key, ...rest }) => ({
      ...rest,
      prefix: this.getApiKeyPrefix(key),
      keyMask: this.getApiKeyMask(key),
    }));
  }

  async createApiKey(
    name: string,
    role: RoleName = RoleName.USER,
    expiresAt?: string,
  ) {
    const key = `dosham-${role.toLowerCase()}-${crypto.randomBytes(16).toString("hex")}`;
    const apiKey = await this.prisma.apiKey.create({
      data: { key, name, role, expiresAt: expiresAt ? new Date(expiresAt) : null },
    });
    return {
      ...apiKey,
      prefix: this.getApiKeyPrefix(key),
      keyMask: this.getApiKeyMask(key),
    };
  }

  async updateApiKey(
    id: string,
    dto: { name?: string; isActive?: boolean; role?: RoleName; expiresAt?: string },
  ) {
    const data: {
      name?: string;
      isActive?: boolean;
      role?: RoleName;
      expiresAt?: Date;
    } = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.role !== undefined) data.role = dto.role;
    if (dto.expiresAt !== undefined) data.expiresAt = new Date(dto.expiresAt);

    const apiKey = await this.prisma.apiKey.update({ where: { id }, data });
    const { key, ...rest } = apiKey;
    return {
      ...rest,
      prefix: this.getApiKeyPrefix(key),
      keyMask: this.getApiKeyMask(key),
    };
  }

  async deleteApiKey(id: string) {
    await this.prisma.apiKey.delete({ where: { id } });
    return { deleted: true };
  }

  // -----------------------------------------------------------------------
  // Users
  // -----------------------------------------------------------------------

  private readonly USER_SELECT = {
    id: true,
    email: true,
    username: true,
    name: true,
    status: true,
    banReason: true,
    emailVerified: true,
    lastLoggedIn: true,
    createdAt: true,
    roles: { select: { role: { select: { name: true } } } },
  } as const;

  private buildUsersWhere(params: {
    q?: string;
    role?: RoleName;
    status?: string;
  }): Prisma.UserWhereInput {
    const { q, role, status } = params;
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const and: Prisma.UserWhereInput[] = [];

    if (q) {
      and.push({
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { email: { contains: q, mode: "insensitive" } },
          { username: { contains: q, mode: "insensitive" } },
        ],
      });
    }

    if (role) {
      and.push({ roles: { some: { role: { name: role } } } });
    }

    if (status === "active") {
      and.push({ status: "active" });
      and.push({ lastLoggedIn: { gte: thirtyDaysAgo } });
    } else if (status === "inactive") {
      and.push({ status: "active" });
      and.push({ OR: [{ lastLoggedIn: null }, { lastLoggedIn: { lt: thirtyDaysAgo } }] });
    } else if (status === "blocked") {
      and.push({ status: "blocked" });
    }

    return and.length > 0 ? { AND: and } : {};
  }

  async listUsers(params: {
    q?: string;
    role?: RoleName;
    status?: string;
    page?: number;
    limit?: number;
    sortBy?: string;
    sortDir?: string;
  }) {
    const { q, role, status, page = 1, limit = 20, sortBy = "createdAt", sortDir = "desc" } = params;
    const skip = (page - 1) * limit;
    const where = this.buildUsersWhere({ q, role, status });

    const dir = sortDir === "asc" ? ("asc" as const) : ("desc" as const);
    const orderBy: Prisma.UserOrderByWithRelationInput =
      sortBy === "name" ? { name: dir }
      : sortBy === "username" ? { username: dir }
      : sortBy === "lastLoggedIn" ? { lastLoggedIn: dir }
      : { createdAt: dir };

    const [data, total] = await Promise.all([
      this.prisma.user.findMany({ where, select: this.USER_SELECT, orderBy, skip, take: limit }),
      this.prisma.user.count({ where }),
    ]);

    return { data, total, page, limit, pages: Math.ceil(total / limit) };
  }

  async getUserStats() {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const firstOfMonth = new Date();
    firstOfMonth.setDate(1);
    firstOfMonth.setHours(0, 0, 0, 0);

    type StatsRow = {
      total: bigint;
      active: bigint;
      blocked: bigint;
      inactive: bigint;
      new_this_month: bigint;
    };

    const [statsRow] = await this.prisma.$queryRaw<StatsRow[]>`
      SELECT
        COUNT(*)                                                                           AS total,
        COUNT(*) FILTER (WHERE status = 'active')                                         AS active,
        COUNT(*) FILTER (WHERE status = 'blocked')                                        AS blocked,
        COUNT(*) FILTER (WHERE status = 'active' AND (
          "lastLoggedIn" IS NULL OR "lastLoggedIn" < ${thirtyDaysAgo}
        ))                                                                                 AS inactive,
        COUNT(*) FILTER (WHERE "createdAt" >= ${firstOfMonth})                            AS new_this_month
      FROM users
    `;

    const [adminCount, editorCount, userCount] = await Promise.all([
      this.prisma.userRoleAssignment.count({ where: { role: { name: RoleName.ADMIN } } }),
      this.prisma.userRoleAssignment.count({ where: { role: { name: RoleName.EDITOR } } }),
      this.prisma.userRoleAssignment.count({ where: { role: { name: RoleName.USER } } }),
    ]);

    return {
      total: Number(statsRow.total),
      active: Number(statsRow.active),
      inactive: Number(statsRow.inactive),
      blocked: Number(statsRow.blocked),
      newThisMonth: Number(statsRow.new_this_month),
      byRole: { ADMIN: adminCount, EDITOR: editorCount, USER: userCount },
    };
  }

  async getUser(userId: string) {
    const [user, lastSession] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: this.USER_SELECT,
      }),
      this.prisma.userSession.findFirst({
        where: { userId },
        orderBy: { lastActiveAt: "desc" },
        select: { ipAddress: true, userAgent: true, lastActiveAt: true },
      }),
    ]);
    if (!user) throw new NotFoundException(`User #${userId} not found`);
    return {
      ...user,
      lastSessionIp: lastSession?.ipAddress ?? null,
      lastSessionUserAgent: lastSession?.userAgent ?? null,
    };
  }

  async updateUser(
    userId: string,
    dto: { name?: string; username?: string; email?: string; role?: RoleName; status?: string },
  ) {
    const exists = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!exists) throw new NotFoundException(`User #${userId} not found`);

    const userUpdates: Prisma.UserUpdateInput = {};
    if (dto.name !== undefined) userUpdates.name = dto.name;
    if (dto.username !== undefined) userUpdates.username = dto.username;
    if (dto.email !== undefined) userUpdates.email = dto.email;
    if (dto.status !== undefined) userUpdates.status = dto.status;

    if (Object.keys(userUpdates).length > 0) {
      try {
        await this.prisma.user.update({ where: { id: userId }, data: userUpdates });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
          throw new ConflictException("Username or email already taken");
        }
        throw e;
      }
    }

    if (dto.role !== undefined) {
      await this.prisma.userRoleAssignment.deleteMany({ where: { userId } });
      await this.assignRole(userId, dto.role);
    }

    return this.getUser(userId);
  }

  async exportUsers(params: { q?: string; role?: RoleName; status?: string }) {
    const where = this.buildUsersWhere(params);
    return this.prisma.user.findMany({
      where,
      select: this.USER_SELECT,
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

  async setUserStatus(userId: string, status: string, banReason?: string) {
    const data: Prisma.UserUpdateInput = { status };
    if (status === "blocked" && banReason !== undefined) data.banReason = banReason;
    if (status === "active") data.banReason = null;
    return this.prisma.user.update({
      where: { id: userId },
      data,
      select: { id: true, username: true, status: true, banReason: true },
    });
  }

  async deleteUser(userId: string) {
    const exists = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!exists) throw new NotFoundException(`User #${userId} not found`);
    await this.prisma.user.delete({ where: { id: userId } });
    return { deleted: true };
  }

  async resetPasswordByAdmin(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true },
    });
    if (!user) throw new NotFoundException(`User #${userId} not found`);

    await this.prisma.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });

    const rawToken = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    await this.prisma.passwordResetToken.create({
      data: { userId: user.id, token: rawToken, expiresAt },
    });

    return { message: "Password reset email sent" };
  }

  async getAdminUserSessions(userId: string) {
    const exists = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!exists) throw new NotFoundException(`User #${userId} not found`);

    const sessions = await this.prisma.userSession.findMany({
      where: { userId, revokedAt: null },
      orderBy: { lastActiveAt: "desc" },
    });

    return sessions.map((s) => ({
      id: s.id,
      userAgent: s.userAgent,
      ipAddress: s.ipAddress,
      createdAt: s.createdAt,
      lastActiveAt: s.lastActiveAt,
      isCurrent: false,
    }));
  }

  async revokeAdminUserSession(userId: string, sessionId: string) {
    const session = await this.prisma.userSession.findFirst({
      where: { id: sessionId, userId, revokedAt: null },
    });
    if (!session) throw new NotFoundException("Сессия не найдена или уже завершена");

    await this.prisma.userSession.update({
      where: { id: sessionId },
      data: { revokedAt: new Date() },
    });

    return { message: "Session revoked" };
  }

  async revokeAllAdminUserSessions(userId: string) {
    const exists = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!exists) throw new NotFoundException(`User #${userId} not found`);

    const result = await this.prisma.userSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    return { count: result.count };
  }

  async getUserActivityStats(userId: string) {
    const exists = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!exists) throw new NotFoundException(`User #${userId} not found`);

    const [favoritesCount, suggestionsTotal, suggestionsApproved, entriesEdited, searchCount, activeDaysData] =
      await Promise.all([
        this.prisma.userFavorite.count({ where: { userId } }),
        this.prisma.suggestion.count({ where: { userId } }),
        this.prisma.suggestion.count({ where: { userId, status: SuggestionStatus.APPROVED } }),
        this.prisma.entryEditLog.count({ where: { userId } }),
        this.prisma.searchHistory.count({ where: { userId } }),
        this.prisma.$queryRaw<{ day: Date }[]>`
          SELECT DISTINCT DATE("createdAt") AS day
          FROM search_history
          WHERE "userId" = ${userId}
          ORDER BY day DESC
          LIMIT 365
        `,
      ]);

    return {
      favoritesCount,
      suggestionsTotal,
      suggestionsApproved,
      entriesEdited,
      searchCount,
      activeDaysStreak: this.calculateStreak(activeDaysData.map((r) => r.day)),
    };
  }

  private calculateStreak(days: Date[]): number {
    if (days.length === 0) return 0;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const daySet = new Set(
      days.map((d) => {
        const n = new Date(d);
        n.setHours(0, 0, 0, 0);
        return n.getTime();
      }),
    );

    let streak = 0;
    const checkDate = new Date(today);
    while (daySet.has(checkDate.getTime())) {
      streak++;
      checkDate.setDate(checkDate.getDate() - 1);
    }
    return streak;
  }

  async getUserActivity(userId: string, limit = 20, offset = 0) {
    const exists = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!exists) throw new NotFoundException(`User #${userId} not found`);

    const FETCH_LIMIT = 100;

    const [sessions, edits, favorites, suggestions] = await Promise.all([
      this.prisma.userSession.findMany({
        where: { userId },
        select: { id: true, ipAddress: true, userAgent: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: FETCH_LIMIT,
      }),
      this.prisma.entryEditLog.findMany({
        where: { userId },
        select: { id: true, entryId: true, action: true, createdAt: true, entry: { select: { word: true } } },
        orderBy: { createdAt: "desc" },
        take: FETCH_LIMIT,
      }),
      this.prisma.userFavorite.findMany({
        where: { userId },
        select: { id: true, entryId: true, createdAt: true, entry: { select: { word: true } } },
        orderBy: { createdAt: "desc" },
        take: FETCH_LIMIT,
      }),
      this.prisma.suggestion.findMany({
        where: { userId },
        select: { id: true, entryId: true, status: true, createdAt: true, entry: { select: { word: true } } },
        orderBy: { createdAt: "desc" },
        take: FETCH_LIMIT,
      }),
    ]);

    type ActivityItem = { type: string; at: Date; meta: Record<string, unknown> };

    const items: ActivityItem[] = [
      ...sessions.map((s) => ({ type: "login", at: s.createdAt, meta: { ip: s.ipAddress, ua: s.userAgent } })),
      ...edits.map((e) => ({
        type: "edit",
        at: e.createdAt,
        meta: { entryId: e.entryId, word: e.entry?.word ?? "", action: e.action },
      })),
      ...favorites.map((f) => ({
        type: "favorite",
        at: f.createdAt,
        meta: { entryId: f.entryId, word: f.entry?.word ?? "" },
      })),
      ...suggestions.map((s) => ({
        type: "suggestion",
        at: s.createdAt,
        meta: { suggestionId: s.id, entryId: s.entryId, word: s.entry?.word ?? "", status: s.status },
      })),
    ];

    items.sort((a, b) => b.at.getTime() - a.at.getTime());

    return { data: items.slice(offset, offset + limit), total: items.length };
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

  async runLoad(userId?: string) {
    const result = await this.mergeService.load();
    void (this.prisma.entryEditLog as any)
      .create({
        data: {
          entryId: null,
          userId: userId ?? null,
          actorType: "pipeline",
          action: "pipeline",
          changes: { command: "load" },
        },
      })
      .catch(() => {});
    return result;
  }

  async runImprove(userId?: string) {
    const result = await this.mergeService.improve();
    void (this.prisma.entryEditLog as any)
      .create({
        data: {
          entryId: null,
          userId: userId ?? null,
          actorType: "pipeline",
          action: "pipeline",
          changes: { command: "improve" },
        },
      })
      .catch(() => {});
    return result;
  }

  async runImproveEntries(ids: number[], userId?: string) {
    const result = await this.mergeService.improveEntries(ids);
    void (this.prisma.entryEditLog as any)
      .create({
        data: {
          entryId: null,
          userId: userId ?? null,
          actorType: "pipeline",
          action: "pipeline",
          changes: { command: "improve-entries", ids },
        },
      })
      .catch(() => {});
    return result;
  }

  async runRollback(step: number, userId?: string) {
    const result = await this.mergeService.rollback(step);
    void (this.prisma.entryEditLog as any)
      .create({
        data: {
          entryId: null,
          userId: userId ?? null,
          actorType: "pipeline",
          action: "pipeline",
          changes: { command: "rollback", step },
        },
      })
      .catch(() => {});
    return result;
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
    const [items, entry] = await Promise.all([
      this.prisma.entryEditLog.findMany({
        where: { entryId },
        include: { user: { select: { id: true, username: true, name: true } } },
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.unifiedEntry.findUnique({
        where: { id: entryId },
        select: { id: true, word: true, partOfSpeech: true, nounClass: true, cefrLevel: true, sources: true },
      }),
    ]);

    if (!entry) throw new NotFoundException(`Entry #${entryId} not found`);

    const uniqueAuthors = new Set(items.map((i) => i.userId).filter(Boolean)).size;
    const createLog = items.find((i) => i.action === "create");
    const daysSinceCreation = createLog
      ? Math.floor((Date.now() - new Date(createLog.createdAt).getTime()) / 86_400_000)
      : null;

    return {
      entry,
      meta: { totalChanges: items.length, uniqueAuthors, daysSinceCreation },
      items,
    };
  }

  async revertEntryLog(entryId: number, logId: string, userId?: string) {
    const log = await this.prisma.entryEditLog.findUnique({ where: { id: logId } });

    if (!log || log.entryId !== entryId) {
      throw new NotFoundException(`Log #${logId} not found for entry #${entryId}`);
    }
    if (log.action === "create" || log.action === "pipeline" || log.action === "revert") {
      throw new BadRequestException(`Cannot revert a log with action "${log.action}"`);
    }

    const changes = log.changes as Record<string, unknown>;
    const updateData: Record<string, unknown> = {};
    const restoredFields: string[] = [];

    for (const [field, value] of Object.entries(changes)) {
      if (field === "_meta") continue;
      if (typeof value === "object" && value !== null && "old" in value) {
        updateData[field] = (value as { old: unknown }).old;
        restoredFields.push(field);
      }
    }

    if (restoredFields.length === 0) {
      throw new BadRequestException("No restorable fields found in this log");
    }

    if ("word" in updateData && typeof updateData.word === "string") {
      updateData.wordNormalized = normalizeWord(updateData.word);
    }

    await (this.prisma.unifiedEntry as any).update({
      where: { id: entryId },
      data: updateData,
    });

    const revertChanges: Record<string, unknown> = { revertOf: logId };
    for (const field of restoredFields) {
      const original = changes[field] as { old: unknown; new: unknown };
      revertChanges[field] = { old: original.new, new: original.old };
    }

    const newLog = await (this.prisma.entryEditLog as any).create({
      data: {
        entryId,
        userId: userId ?? null,
        actorType: "admin",
        action: "revert",
        changes: revertChanges,
      },
    });

    await this.invalidateDictCache();

    return { success: true, newLogId: newLog.id as string, restoredFields };
  }

  private async invalidateDictCache(): Promise<void> {
    try {
      let cursor = "0";
      do {
        const [nextCursor, keys] = await this.redis.scan(cursor, "MATCH", `${DICT_CACHE_PREFIX}:*`, "COUNT", 100);
        cursor = nextCursor;
        if (keys.length > 0) await this.redis.del(...keys);
      } while (cursor !== "0");
    } catch {
      // cache failure is not critical
    }
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

  async getRecentEdits(params: {
    q?: string;
    action?: string;
    actorType?: string;
    period?: string;
    page?: number;
    limit?: number;
  }) {
    const { q, action, actorType, period, page = 1, limit = 20 } = params;
    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = {};

    if (q) {
      where.OR = [
        { entry: { word: { contains: q, mode: "insensitive" } } },
        ...(!isNaN(Number(q)) ? [{ entryId: Number(q) }] : []),
      ];
    }
    if (action) where.action = action;
    if (actorType === "pipeline" || actorType === "api" || actorType === "admin") {
      where.actorType = actorType;
    }
    if (period === "today") {
      where.createdAt = { gte: startOfDay };
    } else if (period === "week") {
      where.createdAt = { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) };
    } else if (period === "month") {
      where.createdAt = { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) };
    }

    const safeLimit = Math.min(Math.max(1, limit), 100);
    const [items, total] = await Promise.all([
      this.prisma.entryEditLog.findMany({
        where,
        include: {
          user: { select: { id: true, username: true, name: true } },
          entry: { select: { id: true, word: true } },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * safeLimit,
        take: safeLimit,
      }),
      this.prisma.entryEditLog.count({ where }),
    ]);

    return { items, total, page, limit: safeLimit, totalPages: Math.ceil(total / safeLimit) };
  }

  async getAuditStats() {
    const now = new Date();
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const startOfYesterday = new Date(startOfToday);
    startOfYesterday.setDate(startOfYesterday.getDate() - 1);
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [todayTotal, yesterdayTotal, weekTotal, weekBulkTotal, weekPipelineTotal] = await Promise.all([
      this.prisma.entryEditLog.count({ where: { createdAt: { gte: startOfToday } } }),
      this.prisma.entryEditLog.count({
        where: { createdAt: { gte: startOfYesterday, lt: startOfToday } },
      }),
      this.prisma.entryEditLog.count({ where: { createdAt: { gte: sevenDaysAgo } } }),
      this.prisma.entryEditLog.count({ where: { action: "bulk", createdAt: { gte: sevenDaysAgo } } }),
      this.prisma.entryEditLog.count({
        where: { action: "pipeline", createdAt: { gte: sevenDaysAgo } },
      }),
    ]);

    type UniqueAuthorsRow = { count: bigint };
    const [uniqueAuthorsRow] = await this.prisma.$queryRaw<UniqueAuthorsRow[]>`
      SELECT COUNT(DISTINCT "userId") AS count
      FROM entry_edit_log
      WHERE "createdAt" >= ${sevenDaysAgo} AND "userId" IS NOT NULL
    `;
    const weekUniqueAuthors = Number(uniqueAuthorsRow.count);

    const bulkLogs = await this.prisma.entryEditLog.findMany({
      where: { action: "bulk", createdAt: { gte: sevenDaysAgo } },
      select: { changes: true },
    });
    const weekBulkAffected = bulkLogs.reduce((sum, log) => {
      const meta = (log.changes as Record<string, unknown> | null)?._meta as
        | Record<string, unknown>
        | undefined;
      return sum + (typeof meta?.count === "number" ? meta.count : 0);
    }, 0);

    type CommandRow = { command: string | null };
    const pipelineRows = await this.prisma.$queryRaw<CommandRow[]>`
      SELECT DISTINCT changes->>'command' AS command
      FROM entry_edit_log
      WHERE action = 'pipeline' AND "createdAt" >= ${sevenDaysAgo}
    `;
    const weekPipelineCommands = pipelineRows
      .map((r) => r.command)
      .filter((c): c is string => c !== null);

    type ActionCountRow = { action: string; count: bigint };
    const actionRows = await this.prisma.$queryRaw<ActionCountRow[]>`
      SELECT action, COUNT(*) AS count FROM entry_edit_log GROUP BY action
    `;
    const byAction: Record<string, number> = {};
    for (const row of actionRows) {
      byAction[row.action] = Number(row.count);
    }

    const deltaPercent =
      yesterdayTotal > 0
        ? Math.round(((todayTotal - yesterdayTotal) / yesterdayTotal) * 100)
        : todayTotal > 0
          ? 100
          : 0;

    return {
      today: { total: todayTotal, deltaPercent },
      week: { total: weekTotal, uniqueAuthors: weekUniqueAuthors },
      weekBulk: { total: weekBulkTotal, affectedEntries: weekBulkAffected },
      weekPipeline: { total: weekPipelineTotal, commands: weekPipelineCommands },
      byAction: {
        create: byAction["create"] ?? 0,
        update: byAction["update"] ?? 0,
        delete: byAction["delete"] ?? 0,
        bulk: byAction["bulk"] ?? 0,
        pipeline: byAction["pipeline"] ?? 0,
        revert: byAction["revert"] ?? 0,
      },
    };
  }

  async exportAuditLog(params: {
    q?: string;
    action?: string;
    actorType?: string;
    period?: string;
  }) {
    const result = await this.getRecentEdits({ ...params, page: 1, limit: 10000 });
    return result.items;
  }
}
