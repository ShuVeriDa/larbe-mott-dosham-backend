import { parseCollectedEntries } from "../collected.parser";

describe("CollectedParser", () => {
  it("parses simple word + translate format", () => {
    const result = parseCollectedEntries([
      { word: "жайна", translate: "книга" },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].word).toBe("жайна");
    expect(result[0].meanings[0].translation).toBe("книга");
  });

  it("passes through extended ParsedEntry format", () => {
    const result = parseCollectedEntries([
      {
        word: "жайна",
        translate: "",
        meanings: [{ translation: "книга" }],
        nounClass: "ду",
      } as any,
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].word).toBe("жайна");
    expect(result[0].nounClass).toBe("ду");
  });

  it("skips entries without word or translate", () => {
    const result = parseCollectedEntries([
      { word: "", translate: "test" },
      { word: "test", translate: "" },
    ]);
    expect(result).toHaveLength(0);
  });
});
