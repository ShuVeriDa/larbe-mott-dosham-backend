import { parseMacievEntries } from "../maciev.parser";

describe("MacievParser", () => {
  it("parses adjective without grammar block", () => {
    const result = parseMacievEntries([
      {
        id: "1",
        word: "абазойн, абазойниг",
        word1: "абазойн, абазойниг",
        translate: "<i>прил.</i> абази́нский.\r\n",
      },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].word).toBe("абазойн");
    expect(result[0].partOfSpeech).toBe("прил.");
    expect(result[0].meanings[0].translation).toContain("абазинский");
  });

  it("parses noun with grammar block and class", () => {
    const result = parseMacievEntries([
      {
        id: "5",
        word: "а́га1",
        word1: "а́га1",
        translate:
          "[а́ганан, а́ганна, а́гано́, а́гане́, <i>д; мн.</i> а́ганаш, <i>д</i>] колыбе́ль, лю́лька.\r\n",
      },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].word).toBe("ага");
    expect(result[0].nounClass).toBe("ду");
    // Grammar forms may retain stress marks from source
    expect(result[0].grammar?.genitive).toBeDefined();
    expect(result[0].grammar?.dative).toBeDefined();
    expect(result[0].grammar?.ergative).toBeDefined();
    expect(result[0].grammar?.plural).toBeDefined();
    expect(result[0].meanings[0].translation).toContain("колыбель");
  });

  it("skips empty entries", () => {
    const result = parseMacievEntries([
      { id: "99", word: "", word1: "", translate: "" },
    ]);
    expect(result).toHaveLength(0);
  });

  it("handles homonym index", () => {
    const result = parseMacievEntries([
      {
        id: "10",
        word: "а́га1",
        word1: "а́га1",
        translate:
          "[а́ганан, а́ганна, а́гано́, а́гане́, <i>д; мн.</i> а́ганаш, <i>д</i>] колыбе́ль, лю́лька.\r\n",
      },
    ]);
    expect(result[0].homonymIndex).toBe(1);
  });
});
