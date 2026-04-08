import { parseNeologismEntries } from "../neologisms.parser";

describe("NeologismsParser", () => {
  it("parses simple format and adds Неол. label", () => {
    const result = parseNeologismEntries([
      { word: "хӀоттамдош", translate: "наречие (грамматический термин)" },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].word).toBe("хӀоттамдош");
    expect(result[0].styleLabel).toBe("Неол.");
    expect(result[0].meanings[0].translation).toContain("наречие");
  });

  it("preserves custom styleLabel in extended format", () => {
    const result = parseNeologismEntries([
      {
        word: "тест",
        translate: "",
        meanings: [{ translation: "тест" }],
        styleLabel: "Калька",
      } as any,
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].styleLabel).toBe("Калька");
  });

  it("adds Неол. to extended format without styleLabel", () => {
    const result = parseNeologismEntries([
      {
        word: "тест",
        translate: "",
        meanings: [{ translation: "тест" }],
      } as any,
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].styleLabel).toBe("Неол.");
  });
});
