import { existsSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import {
  collectSourceFiles,
  defaultScanRoot,
  digestFingerprint,
  fingerprintNodes,
  lineSpan,
  parseSourceFile,
} from "./fingerprint.mjs";

const DEFAULT_IGNORE_PATH = resolve(import.meta.dirname, "fragment-ignores.json");
const DEFAULT_MIN_LINES = 6;
const DEFAULT_MIN_STATEMENTS = 3;
const DEFAULT_MIN_FILES = 2;
const DEFAULT_MAX_REPORTS = 100;
const MIN_FINGERPRINT_LENGTH = 48;

/**
 * @typedef {object} FragmentOccurrence
 * @property {string} sourcePath Absolute path of the declaring file.
 * @property {number} startLine One-based first line of the window.
 * @property {number} endLine One-based last line of the window.
 * @property {number} lineCount Source lines covered by the window.
 * @property {number} statementCount Statements in the window.
 * @property {string} context Enclosing function or method name.
 * @property {string} hash Structural digest of the window.
 */

/**
 * @typedef {object} FragmentIgnoreEntry
 * @property {string} file Scan-root-relative file path.
 * @property {number | undefined} startLine Optional range start.
 * @property {number | undefined} endLine Optional range end.
 */

/**
 * @typedef {object} FragmentScanOptions
 * @property {number} minLines Minimum window line count.
 * @property {number} minStatements Minimum window statement count.
 * @property {number} minFiles Minimum distinct files to report.
 * @property {number} maxReports Maximum clone clusters to report.
 * @property {string | undefined} ignorePath Path to the ignore JSON file.
 */

/**
 * @typedef {object} FragmentScan
 * @property {import("typescript").SourceFile} sourceFile Parsed source file.
 * @property {string} sourcePath Absolute path of the declaring file.
 * @property {string} context Enclosing function or method name.
 * @property {FragmentScanOptions} options Active scan thresholds.
 * @property {FragmentOccurrence[]} fragments Collected fragment windows.
 */

function blockStatements(node) {
  if (ts.isBlock(node)) return node.statements;
  return undefined;
}

function visitForFragments(node, scan) {
  if (ts.isCaseBlock(node)) {
    for (const clause of node.clauses) {
      if (clause.statements.length >= scan.options.minStatements) {
        collectFragmentWindows(clause.statements, scan);
      }
    }
  }

  const statements = blockStatements(node);
  if (statements !== undefined && statements.length >= scan.options.minStatements) {
    collectFragmentWindows(statements, scan);
  }

  if (ts.isFunctionDeclaration(node) && node.name !== undefined) {
    scan.context = node.name.text;
  } else if (ts.isMethodDeclaration(node) && node.name !== undefined) {
    scan.context = node.name.text;
  } else if (ts.isConstructorDeclaration(node)) {
    scan.context = "constructor";
  } else if (ts.isGetAccessorDeclaration(node) && node.name !== undefined) {
    scan.context = `get ${node.name.text}`;
  } else if (ts.isSetAccessorDeclaration(node) && node.name !== undefined) {
    scan.context = `set ${node.name.text}`;
  } else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
    const initializer = node.initializer;
    if (
      initializer !== undefined &&
      (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))
    ) {
      scan.context = node.name.text;
      const body = initializer.body;
      if (ts.isBlock(body)) {
        collectFragmentWindows(body.statements, scan);
      }
    }
  }

  ts.forEachChild(node, (child) => {
    visitForFragments(child, scan);
  });
}

function collectFragmentWindows(statements, scan) {
  const { sourceFile, sourcePath, context, options, fragments } = scan;
  for (let start = 0; start <= statements.length - options.minStatements; start += 1) {
    for (let end = start + options.minStatements; end <= statements.length; end += 1) {
      if (!isMaximalStatementWindow(statements, start, end)) continue;

      const window = statements.slice(start, end);
      const span = lineSpan(sourceFile, window[0], window[window.length - 1]);
      if (span.lineCount < options.minLines) continue;

      const fingerprint = fingerprintNodes(window);
      if (fingerprint.length < MIN_FINGERPRINT_LENGTH) continue;

      fragments.push({
        sourcePath,
        startLine: span.startLine,
        endLine: span.endLine,
        lineCount: span.lineCount,
        statementCount: window.length,
        context,
        hash: digestFingerprint(fingerprint),
      });
    }
  }
}

function isMaximalStatementWindow(statements, start, end) {
  const fingerprint = fingerprintNodes(statements.slice(start, end));
  if (start > 0 && fingerprintNodes(statements.slice(start - 1, end)) === fingerprint) return false;
  if (
    end < statements.length &&
    fingerprintNodes(statements.slice(start, end + 1)) === fingerprint
  ) {
    return false;
  }
  return true;
}

function collectFragments(sourcePath, options) {
  const sourceFile = parseSourceFile(sourcePath);
  /** @type {FragmentScan} */
  const scan = { sourceFile, sourcePath, context: "<module>", options, fragments: [] };
  visitForFragments(sourceFile, scan);
  return scan.fragments;
}

/**
 * Loads the configured ignore entries, or an empty list when no file exists.
 * @param {string | undefined} ignorePath Path to the ignore JSON file.
 * @returns {FragmentIgnoreEntry[]} Validated, normalized ignore entries.
 */
export function loadFragmentIgnoreEntries(ignorePath = DEFAULT_IGNORE_PATH) {
  if (!existsSync(ignorePath)) return [];
  const parsed = JSON.parse(readFileSync(ignorePath, "utf8"));
  if (!Array.isArray(parsed.entries)) {
    throw new Error(`${ignorePath} must contain an "entries" array`);
  }
  return parsed.entries.map((entry) => {
    if (typeof entry.file !== "string") {
      throw new Error(`${ignorePath} entries require a string "file" property`);
    }
    return {
      file: entry.file.replace(/\\/gu, "/"),
      startLine: typeof entry.startLine === "number" ? entry.startLine : undefined,
      endLine: typeof entry.endLine === "number" ? entry.endLine : undefined,
    };
  });
}

function rangesOverlap(startA, endA, startB, endB) {
  return startA <= endB && endA >= startB;
}

/**
 * Returns whether a fragment is suppressed by an ignore entry.
 * @param {FragmentOccurrence} occurrence The fragment window to test.
 * @param {string} root Absolute scan root used to relativize paths.
 * @param {FragmentIgnoreEntry[]} ignoreEntries Active ignore entries.
 */
function isFragmentIgnored(occurrence, root, ignoreEntries) {
  const relativePath = relative(root, occurrence.sourcePath).replace(/\\/gu, "/");
  return ignoreEntries.some((entry) => {
    if (entry.file !== relativePath) return false;
    if (entry.startLine === undefined || entry.endLine === undefined) return true;
    return rangesOverlap(occurrence.startLine, occurrence.endLine, entry.startLine, entry.endLine);
  });
}

function bestOccurrencePerFileAndContext(occurrences) {
  /** @type {Map<string, typeof occurrences[number]>} */
  const best = new Map();
  for (const occurrence of occurrences) {
    const key = `${occurrence.sourcePath}\0${occurrence.context}`;
    const existing = best.get(key);
    if (
      existing === undefined ||
      occurrence.lineCount > existing.lineCount ||
      (occurrence.lineCount === existing.lineCount &&
        occurrence.statementCount > existing.statementCount)
    ) {
      best.set(key, occurrence);
    }
  }
  return [...best.values()];
}

/**
 * Reports statement windows that are structurally identical across files.
 * @param {string} root Absolute directory to scan.
 * @param {Partial<FragmentScanOptions>} overrides Scan threshold overrides.
 * @returns {string[]} Formatted, score-sorted clone reports.
 */
export function findDuplicateFragmentViolations(root, overrides = {}) {
  const options = {
    minLines: overrides.minLines ?? DEFAULT_MIN_LINES,
    minStatements: overrides.minStatements ?? DEFAULT_MIN_STATEMENTS,
    minFiles: overrides.minFiles ?? DEFAULT_MIN_FILES,
    maxReports: overrides.maxReports ?? DEFAULT_MAX_REPORTS,
    ignorePath: overrides.ignorePath ?? DEFAULT_IGNORE_PATH,
  };

  const ignoreEntries = loadFragmentIgnoreEntries(options.ignorePath);
  /** @type {Map<string, FragmentOccurrence[]>} */
  const byHash = new Map();

  for (const sourcePath of collectSourceFiles(root)) {
    for (const fragment of collectFragments(sourcePath, options)) {
      const occurrences = byHash.get(fragment.hash) ?? [];
      occurrences.push(fragment);
      byHash.set(fragment.hash, occurrences);
    }
  }

  /** @type {{ score: number, lines: number, statements: number, files: number, detail: string }[]} */
  const reports = [];

  for (const occurrences of byHash.values()) {
    const active = bestOccurrencePerFileAndContext(
      occurrences.filter((occurrence) => !isFragmentIgnored(occurrence, root, ignoreEntries)),
    );
    const distinctFiles = new Set(active.map(({ sourcePath }) => sourcePath));
    if (active.length < 2 || distinctFiles.size < options.minFiles) continue;

    const lines = active[0]?.lineCount ?? 0;
    const statements = active[0]?.statementCount ?? 0;
    const score = lines * distinctFiles.size;
    const detail = active
      .map(
        ({ sourcePath, startLine, endLine, context }) =>
          `  ${relative(root, sourcePath)}:${startLine}-${endLine} in ${context}`,
      )
      .sort()
      .join("\n");
    reports.push({
      score,
      lines,
      statements,
      files: distinctFiles.size,
      detail: `Fragment clone (${lines} lines, ${statements} statements, ${distinctFiles.size} files, score ${score}):\n${detail}`,
    });
  }

  reports.sort(
    (left, right) =>
      right.lines - left.lines ||
      right.files - left.files ||
      right.statements - left.statements ||
      left.detail.localeCompare(right.detail),
  );

  return formatReports(reports.slice(0, options.maxReports));
}

function formatReports(reports) {
  /** @type {string[]} */
  const formatted = [];
  let previousLines = undefined;
  for (const report of reports) {
    if (previousLines !== report.lines) {
      if (formatted.length > 0) formatted.push("");
      formatted.push(`${report.lines}-line fragment clones:`);
      previousLines = report.lines;
    }
    formatted.push(report.detail);
  }
  return formatted;
}

function parseArgs(argv) {
  /** @type {Partial<FragmentScanOptions> & { root: string | undefined }} */
  const options = { root: undefined };
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--ignore") {
      const next = argv[index + 1];
      if (next === undefined) throw new Error("--ignore requires a path");
      options.ignorePath = resolve(next);
      index += 1;
      continue;
    }
    if (arg === "--min-lines") {
      options.minLines = parsePositiveInt(argv[++index], "--min-lines");
      continue;
    }
    if (arg === "--min-statements") {
      options.minStatements = parsePositiveInt(argv[++index], "--min-statements");
      continue;
    }
    if (arg === "--min-files") {
      options.minFiles = parsePositiveInt(argv[++index], "--min-files");
      continue;
    }
    if (arg === "--max-reports") {
      options.maxReports = parsePositiveInt(argv[++index], "--max-reports");
      continue;
    }
    if (arg.startsWith("-")) throw new Error(`Unknown option: ${arg}`);
    if (options.root === undefined) options.root = resolve(arg);
    else throw new Error(`Unexpected extra argument: ${arg}`);
  }
  return options;
}

function parsePositiveInt(value, flag) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${flag} requires a positive integer`);
  }
  return parsed;
}

const isMain =
  process.argv[1] !== undefined && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  const { root, ...options } = parseArgs(process.argv);
  const scanRoot = root ?? defaultScanRoot(import.meta.dirname);
  const violations = findDuplicateFragmentViolations(scanRoot, options);
  if (violations.length > 0) console.log(violations.join("\n\n"));
}
