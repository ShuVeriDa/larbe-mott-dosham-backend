import { parseIsmailovCeRuEntries } from "../ismailov.parser";

describe("IsmailovCeRuParser", () => {
  it("parses word with class in brackets", () => {
    const result = parseIsmailovCeRuEntries([
      {
        id: "1",
        word: "АапIелг (АапIелгаш) [бу-ду]",
        translate: "указательный палец руки",
      },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].meanings[0].translation).toContain(
      "указательный палец",
    );
  });

  it("parses word with variant in parentheses", () => {
    const result = parseIsmailovCeRuEntries([
      {
        id: "5",
        word: "АвгIан (авхан)",
        translate: "афганец",
      },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].meanings[0].translation).toBe("афганец");
  });

  it("skips empty entries", () => {
    const result = parseIsmailovCeRuEntries([
      { id: "99", word: "", translate: "" },
    ]);
    expect(result).toHaveLength(0);
  });
});
