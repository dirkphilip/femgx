import { describe, expect, it } from "vitest";
import { numbersOf, parseFloatToken, textLines, tokenChunks, tokensOf } from "../../src/io/numbers";

describe("textLines", () => {
  it("yields lines with 1-based line numbers", () => {
    expect([...textLines("a\nb\nc")]).toEqual([
      { text: "a", line: 1 },
      { text: "b", line: 2 },
      { text: "c", line: 3 },
    ]);
  });

  it("strips trailing carriage returns", () => {
    expect([...textLines("a\r\nb\r\n")]).toEqual([
      { text: "a", line: 1 },
      { text: "b", line: 2 },
    ]);
  });

  it("handles an empty source as a single empty line", () => {
    expect([...textLines("")]).toEqual([{ text: "", line: 1 }]);
  });

  it("preserves interior whitespace", () => {
    const [line] = textLines("  1  2  ");
    expect(line?.text).toBe("  1  2  ");
  });
});

describe("parseFloatToken", () => {
  it("parses plain numbers", () => {
    expect(parseFloatToken("42")).toBe(42);
    expect(parseFloatToken("-1.5")).toBe(-1.5);
  });

  it("normalizes Fortran D exponents", () => {
    expect(parseFloatToken("1.0D3")).toBe(1000);
    expect(parseFloatToken("2d-2")).toBe(0.02);
  });

  it("returns undefined for non-numeric or infinite tokens", () => {
    expect(parseFloatToken("abc")).toBeUndefined();
    expect(parseFloatToken("1/2")).toBeUndefined();
  });
});

describe("tokensOf", () => {
  it("splits on whitespace and commas", () => {
    expect(tokensOf("1, 2,  3\t4")).toEqual(["1", "2", "3", "4"]);
  });

  it("ignores comment text after # or !", () => {
    expect(tokensOf("1 2 # comment")).toEqual(["1", "2"]);
    expect(tokensOf("1 2 ! comment")).toEqual(["1", "2"]);
  });

  it("returns an empty array for a blank or comment-only line", () => {
    expect(tokensOf("   ")).toEqual([]);
    expect(tokensOf("# only a comment")).toEqual([]);
  });
});

describe("numbersOf", () => {
  it("parses every token as a number", () => {
    expect(numbersOf("1 2.5 -3")).toEqual([1, 2.5, -3]);
  });

  it("returns undefined when any token is not a number", () => {
    expect(numbersOf("1 two")).toBeUndefined();
  });
});

describe("tokenChunks", () => {
  it("yields bounded chunks of whitespace-separated tokens", () => {
    const chunks = [...tokenChunks("1 2 3 4 5 6 7", 3)];
    expect(chunks).toEqual([["1", "2", "3"], ["4", "5", "6"], ["7"]]);
  });

  it("handles newlines and repeated whitespace", () => {
    const chunks = [...tokenChunks("1\n2  3\n\n4", 2)];
    expect(chunks).toEqual([
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  it("yields nothing for an empty source", () => {
    expect([...tokenChunks("", 4)]).toEqual([]);
  });

  it("emits fresh arrays on every yield", () => {
    const iterator = tokenChunks("1 2 3 4", 2);
    const first = iterator.next().value as string[];
    const second = iterator.next().value as string[];
    expect(first).toEqual(["1", "2"]);
    expect(second).toEqual(["3", "4"]);
    expect(first).not.toBe(second);
  });
});
