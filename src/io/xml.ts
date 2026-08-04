import { IoError } from "./diagnostics";

/**
 * A minimal XML token for the small, well-formed documents the VTU adapter
 * reads. Processing instructions, comments, and doctypes are skipped.
 */
export interface XmlToken {
  readonly kind: "start" | "end" | "text";
  readonly name: string;
  readonly attrs?: Readonly<Record<string, string>>;
  readonly text?: string;
  readonly line: number;
}

/**
 * Scans a well-formed XML document token by token without building a DOM.
 * Text content is trimmed of surrounding whitespace; attributes are captured
 * for start tags. Line numbers are tracked for diagnostics.
 * @yields {XmlToken} a start, end, or text token for each element of the document.
 */
export function* xmlTokens(source: string): Generator<XmlToken, void, void> {
  let line = 1;
  let index = 0;
  while (index < source.length) {
    const open = source.indexOf("<", index);
    if (open === -1) {
      const trailing = source.slice(index).trim();
      if (trailing.length > 0) {
        yield { kind: "text", name: "", text: trailing, line };
      }
      return;
    }
    const rawText = source.slice(index, open);
    const text = rawText.trim();
    if (text.length > 0) {
      yield { kind: "text", name: "", text, line };
    }
    line += countLines(rawText);
    index = open;
    if (source.startsWith("<!--", index)) {
      const close = source.indexOf("-->", index + 4);
      const end = close === -1 ? source.length : close + 3;
      line += countLines(source.slice(index, end));
      index = end;
      continue;
    }
    if (source.startsWith("<?", index) || source.startsWith("<!", index)) {
      const close = source.indexOf(">", index);
      const end = close === -1 ? source.length : close + 1;
      line += countLines(source.slice(index, end));
      index = end;
      continue;
    }
    const close = source.indexOf(">", index);
    if (close === -1) {
      throw new IoError(`Unterminated XML tag at line ${line}`);
    }
    const raw = source.slice(index, close + 1);
    line += countLines(raw);
    if (raw.startsWith("</")) {
      yield { kind: "end", name: tagName(raw, 2), line };
    } else {
      const name = tagName(raw, 1);
      yield { kind: "start", name, attrs: attributesOf(raw), line };
      if (raw.endsWith("/>")) {
        yield { kind: "end", name, line };
      }
    }
    index = close + 1;
  }
}

function tagName(raw: string, from: number): string {
  let end = from;
  while (end < raw.length) {
    const char = raw[end];
    if (char === " " || char === "/" || char === ">") {
      break;
    }
    end += 1;
  }
  const name = raw.slice(from, end);
  if (name.length === 0) {
    throw new IoError(`Malformed XML tag ${JSON.stringify(raw)}`);
  }
  return name;
}

function attributesOf(raw: string): Readonly<Record<string, string>> {
  let nameEnd = 1;
  while (nameEnd < raw.length) {
    const char = raw[nameEnd];
    if (char === " " || char === "/" || char === ">") {
      break;
    }
    nameEnd += 1;
  }
  const body =
    nameEnd === -1
      ? ""
      : raw.slice(nameEnd + 1, raw.endsWith("/>") ? raw.length - 2 : raw.length - 1);
  const attrs: Record<string, string> = {};
  const re = /([A-Za-z_][\w.-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(body)) !== null) {
    const key = match[1];
    const value = match[3] ?? match[4] ?? "";
    if (key !== undefined) {
      attrs[key] = value;
    }
  }
  return attrs;
}

function countLines(text: string): number {
  let count = 0;
  for (let index = 0; index < text.length; index++) {
    if (text[index] === "\n") {
      count += 1;
    }
  }
  return count;
}
