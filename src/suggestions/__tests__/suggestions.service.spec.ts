import { BadRequestException, NotFoundException } from "@nestjs/common";
import { SuggestionStatus } from "@prisma/client";
import { SuggestionsService } from "../suggestions.service";

describe("SuggestionsService", () => {
  let service: SuggestionsService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      unifiedEntry: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      suggestion: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        count: jest.fn(),
      },
      $transaction: jest.fn((fn: (tx: any) => Promise<any>) => fn(prisma)),
    };
    service = new SuggestionsService(prisma);
  });

  describe("create", () => {
    it("creates suggestion for valid editable field", async () => {
      prisma.unifiedEntry.findUnique.mockResolvedValue({
        id: 1,
        word: "стаг",
        partOfSpeech: "сущ.",
      });
      prisma.suggestion.create.mockResolvedValue({ id: "s1" });

      const result = await service.create("user-1", 1, "word", "стаг (новый)");

      expect(result).toEqual({ id: "s1" });
      expect(prisma.suggestion.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: "user-1",
          entryId: 1,
          field: "word",
          newValue: "стаг (новый)",
          oldValue: '"стаг"',
        }),
      });
    });

    it("throws BadRequestException for non-editable field", async () => {
      await expect(service.create("user-1", 1, "id", "999")).rejects.toThrow(
        BadRequestException,
      );
    });

    it("throws BadRequestException for system field 'createdAt'", async () => {
      await expect(
        service.create("user-1", 1, "createdAt", "2024-01-01"),
      ).rejects.toThrow(BadRequestException);
    });

    it("throws NotFoundException for missing entry", async () => {
      prisma.unifiedEntry.findUnique.mockResolvedValue(null);

      await expect(
        service.create("user-1", 999, "word", "test"),
      ).rejects.toThrow(NotFoundException);
    });

    it("handles null old value", async () => {
      prisma.unifiedEntry.findUnique.mockResolvedValue({
        id: 1,
        word: "стаг",
        latinName: null,
      });
      prisma.suggestion.create.mockResolvedValue({ id: "s1" });

      await service.create("user-1", 1, "latinName", "Homo sapiens");

      expect(prisma.suggestion.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ oldValue: null }),
      });
    });
  });

  describe("list", () => {
    it("returns paginated results with meta", async () => {
      prisma.suggestion.findMany.mockResolvedValue([{ id: "s1" }]);
      prisma.suggestion.count.mockResolvedValue(1);

      const result = await service.list(undefined, 10, 0);

      expect(result.data).toHaveLength(1);
      expect(result.meta).toEqual({ total: 1, limit: 10, offset: 0 });
    });

    it("filters by status", async () => {
      prisma.suggestion.findMany.mockResolvedValue([]);
      prisma.suggestion.count.mockResolvedValue(0);

      await service.list(SuggestionStatus.PENDING, 50, 0);

      expect(prisma.suggestion.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: SuggestionStatus.PENDING },
        }),
      );
    });
  });

  describe("review", () => {
    const pendingSuggestion = {
      id: "s1",
      entryId: 1,
      field: "word",
      newValue: '"стагНовый"',
      status: SuggestionStatus.PENDING,
    };

    it("throws NotFoundException for missing suggestion", async () => {
      prisma.suggestion.findUnique.mockResolvedValue(null);

      await expect(service.review("s99", "admin-1", "approve")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("throws BadRequestException for already reviewed suggestion", async () => {
      prisma.suggestion.findUnique.mockResolvedValue({
        ...pendingSuggestion,
        status: SuggestionStatus.APPROVED,
      });

      await expect(service.review("s1", "admin-1", "approve")).rejects.toThrow(
        BadRequestException,
      );
    });

    it("applies change to entry on approve", async () => {
      prisma.suggestion.findUnique.mockResolvedValue(pendingSuggestion);
      prisma.suggestion.update.mockResolvedValue({
        ...pendingSuggestion,
        status: SuggestionStatus.APPROVED,
      });

      await service.review("s1", "admin-1", "approve");

      expect(prisma.unifiedEntry.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { word: "стагНовый" },
      });
    });

    it("does NOT apply change on reject", async () => {
      prisma.suggestion.findUnique.mockResolvedValue(pendingSuggestion);
      prisma.suggestion.update.mockResolvedValue({
        ...pendingSuggestion,
        status: SuggestionStatus.REJECTED,
      });

      await service.review("s1", "admin-1", "reject");

      expect(prisma.unifiedEntry.update).not.toHaveBeenCalled();
    });
  });
});
