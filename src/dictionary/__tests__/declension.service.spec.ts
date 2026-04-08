import { DeclensionService } from "../declension.service";

describe("DeclensionService", () => {
  let service: DeclensionService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      unifiedEntry: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
      },
    };
    service = new DeclensionService(prisma);
  });

  describe("detectType", () => {
    it("detects type I by instrumental ending -ца", () => {
      expect(service.detectType({ instrumental: "стагаца" })).toBe(1);
    });

    it("detects type II by instrumental ending -нца", () => {
      expect(service.detectType({ instrumental: "горанца" })).toBe(2);
    });

    it("detects type III by instrumental ending -ица", () => {
      expect(service.detectType({ instrumental: "мачица" })).toBe(3);
    });

    it("detects type IV by instrumental ending -чунца", () => {
      expect(service.detectType({ instrumental: "белхалочуьнца" })).toBe(4);
    });

    it("falls back to genitive: type IV (-чун)", () => {
      expect(service.detectType({ genitive: "белхалочун" })).toBe(4);
    });

    it("falls back to genitive: type III (-ин)", () => {
      expect(service.detectType({ genitive: "мачин" })).toBe(3);
    });

    it("defaults to type I when no data", () => {
      expect(service.detectType({})).toBe(1);
    });
  });

  describe("getParadigm", () => {
    it("returns null when word not in DB", async () => {
      prisma.unifiedEntry.findFirst.mockResolvedValue(null);

      const result = await service.getParadigm("несуществующее");

      expect(result).toBeNull();
    });

    it("generates singular paradigm for type I noun", async () => {
      prisma.unifiedEntry.findFirst.mockResolvedValue({
        word: "стаг",
        grammar: {},
      });

      const result = await service.getParadigm("стаг");

      expect(result).not.toBeNull();
      expect(result!.word).toBe("стаг");
      expect(result!.declensionType).toBe(1);
      expect(result!.singular.nominative).toBe("стаг");
      expect(result!.singular.genitive).toBe("стаган");
      expect(result!.singular.dative).toBe("стагна");
      expect(result!.singular.ergative).toBe("стаго");
      expect(result!.singular.instrumental).toBe("стагца");
      expect(result!.plural).toBeNull();
    });

    it("uses saved grammar forms over generated ones", async () => {
      prisma.unifiedEntry.findFirst.mockResolvedValue({
        word: "стаг",
        grammar: { genitive: "стеган", instrumental: "стагаца" },
      });

      const result = await service.getParadigm("стаг");

      expect(result!.singular.genitive).toBe("стеган");
      expect(result!.singular.instrumental).toBe("стагаца");
    });

    it("generates plural paradigm when plural form exists", async () => {
      prisma.unifiedEntry.findFirst.mockResolvedValue({
        word: "стаг",
        grammar: { plural: "стагаш" },
      });

      const result = await service.getParadigm("стаг");

      expect(result!.plural).not.toBeNull();
      expect(result!.plural!.nominative).toBe("стагаш");
      expect(result!.plural!.genitive).toBe("стагашийн");
      expect(result!.plural!.dative).toBe("стагашна");
    });
  });

  describe("lemmatize", () => {
    it("returns empty array for very short form", async () => {
      const result = await service.lemmatize("а");

      expect(result).toEqual([]);
      expect(prisma.unifiedEntry.findMany).not.toHaveBeenCalled();
    });

    it("strips case endings and looks up candidates", async () => {
      prisma.unifiedEntry.findMany.mockResolvedValue([{ word: "стаг" }]);

      const result = await service.lemmatize("стагна");

      expect(result).toEqual(["стаг"]);
      expect(prisma.unifiedEntry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { wordNormalized: { in: expect.any(Array) } },
        }),
      );
    });

    it("deduplicates results", async () => {
      prisma.unifiedEntry.findMany.mockResolvedValue([
        { word: "стаг" },
        { word: "стаг" },
      ]);

      const result = await service.lemmatize("стагна");

      expect(result).toEqual(["стаг"]);
    });
  });
});
