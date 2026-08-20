import { existsSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import {
  collectSourceFiles,
  defaultScanRoot,
  lineSpan,
  parseSourceFile,
  structuralFingerprint,
} from "./fingerprint.mjs";

const DEFAULT_IGNORE_PATH = resolve(import.meta.dirname, "fragment-ignores.json");
const DEFAULT_MIN_LINES = 6;
const DEFAULT_MIN_STATEMENTS = 3;
const DEFAULT_MIN_FILES = 2;

/**
 * @typedef {object} FragmentOccurrence
 * @property {string} sourcePath Absolute path of the declaring file.
 * @property {number} startLine One-based first line of the window.
 * @property {number} endLine One-based last line of the window.
 * @property {number} lineCount Source lines covered by the window.
 * @property {number} statementCount Statements in the window.
 * @property {string} context Enclosing function or method name.
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
 * @property {number | undefined} maxReports Optional maximum clone clusters to report.
 * @property {string | undefined} ignorePath Path to the ignore JSON file.
 */

/**
 * @typedef {object} FragmentSequence
 * @property {Map<string, FragmentSequence>} children Continuations keyed by statement shape.
 * @property {FragmentOccurrence[]} occurrences Windows ending at this sequence.
 */

/**
 * @typedef {object} FragmentIndex
 * @property {import("typescript").SourceFile} sourceFile Parsed source file.
 * @property {string} sourcePath Absolute path of the declaring file.
 * @property {FragmentScanOptions} options Active scan thresholds.
 * @property {FragmentSequence} rootSequence Shared sequence index root.
 */

function contextForNode(node, context) {
  if (ts.isFunctionDeclaration(node) && node.name !== undefined) return node.name.text;
  if (ts.isMethodDeclaration(node) && node.name !== undefined) return node.name.getText();
  if (ts.isConstructorDeclaration(node)) return "constructor";
  if (ts.isGetAccessorDeclaration(node) && node.name !== undefined) {
    return `get ${node.name.getText()}`;
  }
  if (ts.isSetAccessorDeclaration(node) && node.name !== undefined) {
    return `set ${node.name.getText()}`;
  }
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
    const initializer = node.initializer;
    if (
      initializer !== undefined &&
      (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))
    ) {
      return node.name.text;
    }
  }
  return context;
}

function visitForFragments(node, context, index) {
  const nextContext = contextForNode(node, context);
  if (ts.isCaseBlock(node)) {
    for (const clause of node.clauses) {
      if (clause.statements.length >= index.options.minStatements) {
        indexFragmentWindows(clause.statements, nextContext, index);
      }
    }
  }

  if (ts.isBlock(node) && node.statements.length >= index.options.minStatements) {
    indexFragmentWindows(node.statements, nextContext, index);
  }

  ts.forEachChild(node, (child) => {
    visitForFragments(child, nextContext, index);
  });
}

function indexFragmentWindows(statements, context, index) {
  const { sourceFile, sourcePath, options, rootSequence } = index;
  const fingerprints = statements.map((statement) => structuralFingerprint(statement));
  for (let start = 0; start <= statements.length - options.minStatements; start += 1) {
    let sequence = rootSequence;
    for (let end = start; end < statements.length; end += 1) {
      sequence = childSequence(sequence, fingerprints[end]);
      const statementCount = end - start + 1;
      if (statementCount < options.minStatements) continue;
      const span = lineSpan(sourceFile, statements[start], statements[end]);
      if (span.lineCount < options.minLines) continue;
      sequence.occurrences.push({
        sourcePath,
        startLine: span.startLine,
        endLine: span.endLine,
        lineCount: span.lineCount,
        statementCount,
        context,
      });
    }
  }
}

function childSequence(sequence, fingerprint) {
  let child = sequence.children.get(fingerprint);
  if (child === undefined) {
    child = { children: new Map(), occurrences: [] };
    sequence.children.set(fingerprint, child);
  }
  return child;
}

function indexFragments(sourcePath, options, rootSequence) {
  const sourceFile = parseSourceFile(sourcePath);
  /** @type {FragmentIndex} */
  const index = { sourceFile, sourcePath, options, rootSequence };
  visitForFragments(sourceFile, "<module>", index);
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

function uniqueOccurrences(occurrences) {
  const unique = new Map();
  for (const occurrence of occurrences) {
    const key = `${occurrence.sourcePath}\0${occurrence.startLine}\0${occurrence.endLine}`;
    unique.set(key, occurrence);
  }
  return [...unique.values()];
}

function collectDuplicateClusters(sequence, root, ignoreEntries, minFiles, clusters) {
  const active = uniqueOccurrences(
    sequence.occurrences.filter(
      (occurrence) => !isFragmentIgnored(occurrence, root, ignoreEntries),
    ),
  );
  if (new Set(active.map(({ sourcePath }) => sourcePath)).size >= minFiles) clusters.push(active);
  for (const child of sequence.children.values()) {
    collectDuplicateClusters(child, root, ignoreEntries, minFiles, clusters);
  }
}

function occurrenceContains(container, contained) {
  return (
    container.sourcePath === contained.sourcePath &&
    container.context === contained.context &&
    container.startLine <= contained.startLine &&
    container.endLine >= contained.endLine
  );
}

function isSubsumedCluster(cluster, longerClusters) {
  return longerClusters.some((longer) =>
    cluster.every((occurrence) =>
      longer.some((candidate) => occurrenceContains(candidate, occurrence)),
    ),
  );
}

function maximalClusters(clusters) {
  const ordered = clusters.sort(
    (left, right) => (right[0]?.statementCount ?? 0) - (left[0]?.statementCount ?? 0),
  );
  const maximal = [];
  for (const cluster of ordered) {
    if (!isSubsumedCluster(cluster, maximal)) maximal.push(cluster);
  }
  return maximal;
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
    maxReports: overrides.maxReports,
    ignorePath: overrides.ignorePath ?? DEFAULT_IGNORE_PATH,
  };

  const ignoreEntries = loadFragmentIgnoreEntries(options.ignorePath);
  /** @type {FragmentSequence} */
  const rootSequence = { children: new Map(), occurrences: [] };

  for (const sourcePath of collectSourceFiles(root)) {
    indexFragments(sourcePath, options, rootSequence);
  }

  const clusters = [];
  collectDuplicateClusters(rootSequence, root, ignoreEntries, options.minFiles, clusters);
  /** @type {{ score: number, lines: number, statements: number, files: number, detail: string }[]} */
  const reports = [];

  for (const active of maximalClusters(clusters)) {
    const files = new Set(active.map(({ sourcePath }) => sourcePath)).size;
    const lines = Math.max(...active.map(({ lineCount }) => lineCount));
    const statements = active[0]?.statementCount ?? 0;
    const score = lines * files;
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
      files,
      detail: `Fragment clone (${lines} lines, ${statements} statements, ${files} files, score ${score}):\n${detail}`,
    });
  }

  reports.sort(
    (left, right) =>
      right.lines - left.lines ||
      right.files - left.files ||
      right.statements - left.statements ||
      left.detail.localeCompare(right.detail),
  );

  const selectedReports =
    options.maxReports === undefined ? reports : reports.slice(0, options.maxReports);
  return formatReports(selectedReports);
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
