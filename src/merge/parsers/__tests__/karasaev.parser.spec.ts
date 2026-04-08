import { parseKarasaevEntries } from "../karasaev.parser";

describe("KarasaevParser", () => {
  it("parses ru→nah adjective", () => {
    const result = parseKarasaevEntries([
      {
        id: "1",
        word: "абази́нский, -ая, -ое",
        word1: "абазинский, -ая, -ое",
        translate: "абазойн; <b>абази́нский язы́к</b> абазойн мотт\r\n",
      },
    ]);
    expect(result).toHaveLength(1);
    // Karasaev is ru→nah: word = Russian headword, meanings = Chechen translations
    expect(result[0].word).toBe("абазинский");
    expect(result[0].meanings[0].translation).toContain("абазойн");
  });

  it("parses entry with numbered meanings", () => {
    const result = parseKarasaevEntries([
      {
        id: "3",
        word: "абсолю́тный -ая, -ое",
        word1: "абсолютный -ая, -ое",
        translate:
          "1) <i>филос.</i> абсолютни, цӀена (<i>дуьстина, дозуш доцу</i>) 2) (<i>совершенный, полный</i>) дуьззина; <b>абсолю́тный поко́й</b> буьззина тем ◊ <b>абсолю́тное большинство́</b> къаьсттина дукхахберш; <b>абсолю́тная мона́рхия</b> абсолютни монархи\r\n",
      },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].meanings.length).toBeGreaterThanOrEqual(1);
  });
});
