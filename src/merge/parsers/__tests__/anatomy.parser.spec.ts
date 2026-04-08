import {
  parseAnatomyCeRuEntries,
  parseAnatomyRuCeEntries,
} from "../anatomy.parser";

describe("AnatomyCeRuParser", () => {
  it("parses entry with latin name", () => {
    const result = parseAnatomyCeRuEntries([
      {
        id: "5",
        word: "Милк (йоӀзаран хьалхара даьӀахк)",
        translate:
          "Атлант (первый шейный позвонок) (Atlas)     <i>Милкан хоттарг кхуллу даьӀахк</i>\r\n",
      },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].meanings[0].translation).toContain("Атлант");
    expect(result[0].latinName).toBeDefined();
    expect(result[0].domain).toBe("anatomy");
  });

  it("skips empty word entries", () => {
    const result = parseAnatomyCeRuEntries([
      { id: "99", word: "", translate: "something" },
    ]);
    expect(result).toHaveLength(0);
  });
});
