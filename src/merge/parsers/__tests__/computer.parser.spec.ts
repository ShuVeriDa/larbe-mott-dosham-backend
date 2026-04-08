import { parseComputerEntries } from "../computer.parser";

describe("ComputerParser", () => {
  it("parses ru→nah entry with examples", () => {
    const result = parseComputerEntries([
      {
        id: "1",
        word: "дефе́ктный ключ",
        word1: "дефектный ключ",
        translate:
          "доьхна до̃гӀа<br /><b>этот дефект часто можно исправить –</b> и кхачамбацар дукха хьолахь нисдан йиш ю\r\n",
      },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].domain).toBe("computer");
    expect(result[0].meanings[0].translation).toBeDefined();
  });

  it("parses entry with noun class in translate", () => {
    const result = parseComputerEntries([
      {
        id: "5",
        word: "смарт-ка́рта",
        word1: "смарт-карта",
        translate:
          "смарт-карта <i>(д, д)</i><br /><b>смарт-карта цифрового тв –</b> терахьийн телевиденин смарт-карта\r\n",
      },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].domain).toBe("computer");
    expect(result[0].nounClass).toBe("ду");
  });

  it("skips entries with empty translate", () => {
    const result = parseComputerEntries([
      { id: "99", word: "test", word1: "test", translate: "" },
    ]);
    expect(result).toHaveLength(0);
  });
});
