import { parseBaisultanovEntries } from "../baisultanov.parser";

describe("BaisultanovParser", () => {
  it("parses word with plural in parentheses", () => {
    const result = parseBaisultanovEntries([
      {
        id: "5",
        word: "Агана (-ш)",
        translate:
          "Старин. Лощина.<br /><b>Кхоьриа агана </b>(Кхёрна агана) «Грушевая лощина»... <b>МаьӀнийн агана </b>(Мяънийн агана) «Ольховая лощина» (из кн. А.Сулейманова. «Топонимия Чечни»).\r\n",
      },
    ]);
    expect(result).toHaveLength(1);
    // Baisultanov parser preserves original casing
    expect(result[0].word.toLowerCase()).toBe("агана");
    expect(result[0].meanings[0].translation).toContain("Лощина");
  });

  it("parses entry with religious content", () => {
    const result = parseBaisultanovEntries([
      {
        id: "1",
        word: "Аввабин (аввабин-ламаз)",
        translate:
          "Ночная молитва в исламе.<br />Имам Шавкáнийс – Дала къинхетам бойла цунах – аьлла «Найлул АвтӀóр» тӀехь...\r\n",
      },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].word.toLowerCase()).toBe("аввабин");
    expect(result[0].meanings[0].translation).toContain("Ночная молитва");
  });

  it("skips empty translations", () => {
    const result = parseBaisultanovEntries([
      { id: "100", word: "test", translate: "" },
    ]);
    expect(result).toHaveLength(0);
  });
});
