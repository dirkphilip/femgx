import { describe, expect, it } from "vitest";
import { IoError } from "../../src/io/diagnostics";
import { xmlTokens } from "../../src/io/xml";

describe("xmlTokens", () => {
  it("yields start, text, and end tokens in document order", () => {
    const tokens = [...xmlTokens("<root><a>hello</a></root>")];
    expect(tokens.map((token) => token.kind)).toEqual(["start", "start", "text", "end", "end"]);
    expect(tokens[0]?.name).toBe("root");
    expect(tokens[1]?.name).toBe("a");
    expect(tokens[2]?.text).toBe("hello");
  });

  it("captures attributes on start tags", () => {
    const [root] = xmlTokens('<root type="UnstructuredGrid" count="3" />');
    expect(root?.attrs).toEqual({ type: "UnstructuredGrid", count: "3" });
  });

  it("yields an implicit end for self-closing tags", () => {
    const tokens = [...xmlTokens("<root><a /></root>")];
    expect(tokens.map((token) => `${token.kind}:${token.name}`)).toEqual([
      "start:root",
      "start:a",
      "end:a",
      "end:root",
    ]);
  });

  it("skips comments, processing instructions, and doctypes", () => {
    const tokens = [...xmlTokens('<?xml version="1.0"?><root><!-- comment --><a/></root>')];
    expect(tokens.map((token) => token.name)).toEqual(["root", "a", "a", "root"]);
  });

  it("tracks line numbers across multi-line documents", () => {
    const source = "<root>\n  <a>text</a>\n</root>";
    const tokens = [...xmlTokens(source)];
    const a = tokens.find((token) => token.name === "a");
    expect(a?.line).toBe(2);
    const root = tokens.find((token) => token.name === "root");
    expect(root?.line).toBe(1);
  });

  it("reports text between tags, trimmed", () => {
    const source = "<a>  hello world  </a>";
    const tokens = [...xmlTokens(source)];
    expect(tokens[1]?.text).toBe("hello world");
  });

  it("throws an IoError for an unterminated tag", () => {
    expect(() => [...xmlTokens("<root><a")]).toThrow(IoError);
  });

  it("parses quoted attributes with single or double quotes", () => {
    const [root] = xmlTokens("<root a='1' b=\"2\">");
    expect(root?.attrs).toEqual({ a: "1", b: "2" });
  });
});
