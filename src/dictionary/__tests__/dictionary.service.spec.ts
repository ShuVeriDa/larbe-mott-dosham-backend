import { NotFoundException } from "@nestjs/common";
import { DictionaryService } from "../dictionary.service";

describe("DictionaryService", () => {
  let service: DictionaryService;
  let prisma: any;
  let redis: any;
  let declensionService: any;

  beforeEach(() => {
    prisma = {
      unifiedEntry: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        update: jest.fn(),
      },
      $queryRaw: jest.fn(),
      $transaction: jest.fn(),
    };

    redis = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue("OK"),
      scan: jest.fn().mockResolvedValue(["0", []]),
      del: jest.fn().mockResolvedValue(1),
    };

    declensionService = {
      lemmatize: jest.fn().mockResolvedValue([]),
    };

    service = new DictionaryService(prisma, declensionService, redis);
  });

  describe("lookup", () => {
    it("returns entries from DB on cache miss", async () => {
      const entries = [{ id: 1, word: "стаг", wordNormalized: "стаг" }];
      prisma.unifiedEntry.findMany.mockResolvedValue(entries);

      const result = await service.lookup("стаг");

      expect(result).toEqual(entries);
      expect(prisma.unifiedEntry.findMany).toHaveBeenCalledWith({
        where: {
          OR: [{ wordNormalized: "стаг" }, { variants: { has: "стаг" } }],
        },
        orderBy: { id: "asc" },
      });
      expect(redis.set).toHaveBeenCalled();
    });

    it("returns cached result on cache hit", async () => {
      const cached = [{ id: 1, word: "стаг" }];
      redis.get.mockResolvedValue(JSON.stringify(cached));

      const result = await service.lookup("стаг");

      expect(result).toEqual(cached);
      expect(prisma.unifiedEntry.findMany).not.toHaveBeenCalled();
    });

    it("trims whitespace from input", async () => {
      prisma.unifiedEntry.findMany.mockResolvedValue([]);

      await service.lookup("  стаг  ");

      expect(prisma.unifiedEntry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([{ wordNormalized: "стаг" }]),
          }),
        }),
      );
    });
  });

  describe("getById", () => {
    it("returns entry when found", async () => {
      const entry = { id: 1, word: "стаг" };
      prisma.unifiedEntry.findUnique.mockResolvedValue(entry);

      const result = await service.getById(1);

      expect(result).toEqual(entry);
    });

    it("throws NotFoundException when not found", async () => {
      prisma.unifiedEntry.findUnique.mockResolvedValue(null);

      await expect(service.getById(999)).rejects.toThrow(NotFoundException);
    });
  });

  describe("random", () => {
    it("returns null when no entries", async () => {
      prisma.unifiedEntry.count.mockResolvedValue(0);

      const result = await service.random();

      expect(result).toBeNull();
      expect(prisma.unifiedEntry.findFirst).not.toHaveBeenCalled();
    });

    it("returns a random entry", async () => {
      const entry = { id: 5, word: "нана" };
      prisma.unifiedEntry.count.mockResolvedValue(10);
      prisma.unifiedEntry.findFirst.mockResolvedValue(entry);

      const result = await service.random();

      expect(result).toEqual(entry);
      expect(prisma.unifiedEntry.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: {}, skip: expect.any(Number) }),
      );
    });

    it("filters by cefr when provided", async () => {
      prisma.unifiedEntry.count.mockResolvedValue(5);
      prisma.unifiedEntry.findFirst.mockResolvedValue({ id: 1 });

      await service.random("A1");

      expect(prisma.unifiedEntry.count).toHaveBeenCalledWith({
        where: { cefrLevel: "A1" },
      });
      expect(prisma.unifiedEntry.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { cefrLevel: "A1" } }),
      );
    });
  });

  describe("updateEntry", () => {
    it("updates and invalidates cache", async () => {
      const entry = { id: 1, word: "стаг" };
      prisma.unifiedEntry.findUnique.mockResolvedValue(entry);
      prisma.unifiedEntry.update.mockResolvedValue({
        ...entry,
        word: "стагНовый",
      });

      const result = await service.updateEntry(1, { word: "стагНовый" });

      expect(result.word).toBe("стагНовый");
      expect(redis.scan).toHaveBeenCalled();
    });

    it("throws NotFoundException for missing entry", async () => {
      prisma.unifiedEntry.findUnique.mockResolvedValue(null);

      await expect(service.updateEntry(999, { word: "x" })).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("cache", () => {
    it("gracefully handles redis get failure", async () => {
      redis.get.mockRejectedValue(new Error("Redis down"));
      prisma.unifiedEntry.findMany.mockResolvedValue([]);

      const result = await service.lookup("тест");

      expect(result).toEqual([]);
    });

    it("gracefully handles redis set failure", async () => {
      redis.set.mockRejectedValue(new Error("Redis down"));
      prisma.unifiedEntry.findMany.mockResolvedValue([]);

      await expect(service.lookup("тест")).resolves.not.toThrow();
    });
  });
});
