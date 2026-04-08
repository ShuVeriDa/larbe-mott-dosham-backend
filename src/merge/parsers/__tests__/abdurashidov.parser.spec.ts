import { parseAbdurashidovEntries } from "../abdurashidov.parser";

describe("AbdurashidovParser", () => {
  it("parses entry with noun class and declension", () => {
    // AbdurashidovRawEntry uses `translation` not `translate`
    const result = parseAbdurashidovEntries([
      {
        id: "1",
        word: "авантюра",
        translation: "авантюра",
        section: "ce_ru",
        etymology: "фр.",
        nounClass: "ю",
        plural: "авантюраш ю",
        declension: "авантюрин, авантюрина, авантюро, авантюре",
      } as any,
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].word).toBe("авантюра");
    expect(result[0].nounClass).toBe("йу");
    expect(result[0].meanings.length).toBeGreaterThanOrEqual(1);
    expect(result[0].meanings[0].translation).toBe("авантюра");
    expect(result[0].domain).toBe("law");
  });

  it("parses entry with sub-entries as examples", () => {
    const result = parseAbdurashidovEntries([
      {
        id: "4",
        word: "автор",
        translation: "автор",
        section: "ce_ru",
        etymology: "фр.",
        nounClass: "в, ю",
        plural: "авторш б",
        declension: "авторан, авторна, авторо, авторе",
        subEntries: [
          {
            phrase: "авторан барт",
            nounClass: "б, б",
            translation: "авторский договор",
          },
        ],
      } as any,
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].word).toBe("автор");
    // Sub-entries are stored as examples within the meaning
    expect(result[0].meanings[0].examples).toBeDefined();
    expect(result[0].meanings[0].examples!.length).toBeGreaterThanOrEqual(1);
  });
});
