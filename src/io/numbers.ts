/** A single source line with its 1-based line number for diagnostics. */
export interface SourceLine {
  readonly text: string;
  readonly line: number;
}

/**
 * Yields the lines of `source` one at a time without materializing an array,
 * so very large documents can be streamed through a parser.
 * @yields {SourceLine} one `{ text, line }` pair for each line of the source.
 */
export function* textLines(source: string): Generator<SourceLine, void, void> {
  let lineNumber = 1;
  let start = 0;
  let sawNewline = false;
  for (let index = 0; index < source.length; index++) {
    if (source[index] === "\n") {
      yield { text: stripCarriageReturn(source.slice(start, index)), line: lineNumber };
      lineNumber += 1;
      start = index + 1;
      sawNewline = true;
    }
  }
  if (!sawNewline || start < source.length) {
    yield { text: stripCarriageReturn(source.slice(start)), line: lineNumber };
  }
}

function stripCarriageReturn(text: string): string {
  return text.endsWith("\r") ? text.slice(0, -1) : text;
}

/**
 * Parses a single numeric token, normalizing Fortran-style `D`/`d` exponents
 * (common in solver files) to `E`. Returns `undefined` when the token is not a
 * finite number.
 */
export function parseFloatToken(token: string): number | undefined {
  const normalized = token.replace(/[dD]/g, "e");
  const value = Number(normalized);
  return Number.isFinite(value) ? value : undefined;
}

/**
 * Splits a line into whitespace- and comma-separated tokens, ignoring empty
 * tokens and inline comment text after a hash or exclamation mark.
 */
export function tokensOf(line: string): readonly string[] {
  const beforeComment = line.split(/[#!]/)[0] ?? line;
  return beforeComment
    .trim()
    .split(/[\s,]+/)
    .filter((token) => token.length > 0);
}

/**
 * Parses every token of a line as a number. Returns `undefined` when any token
 * is not a finite number, so callers can report an issue with the offending
 * line rather than silently dropping data.
 */
export function numbersOf(line: string): readonly number[] | undefined {
  const tokens = tokensOf(line);
  if (tokens.length === 0) {
    return [];
  }
  const values: number[] = [];
  for (const token of tokens) {
    const value = parseFloatToken(token);
    if (value === undefined) {
      return undefined;
    }
    values.push(value);
  }
  return values;
}

/**
 * Yields the whitespace-separated tokens of `source` in bounded chunks, so a
 * very large numeric data block can be streamed without materializing every
 * token at once.
 * @yields {string[]} arrays of up to `chunkSize` tokens.
 */
export function* tokenChunks(source: string, chunkSize: number): Generator<string[], void, void> {
  const chunk: string[] = [];
  let token = "";
  for (let index = 0; index <= source.length; index += 1) {
    const char = source[index];
    if (char === undefined || /\s/.test(char)) {
      if (token.length > 0) {
        chunk.push(token);
        token = "";
        if (chunk.length === chunkSize) {
          yield chunk.slice();
          chunk.length = 0;
        }
      }
    } else {
      token += char;
    }
  }
  if (chunk.length > 0) {
    yield chunk.slice();
  }
}
