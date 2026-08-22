import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const repositoryRoot = dirname(fileURLToPath(import.meta.url));
const attachmentRoot = join(repositoryRoot, "..", "src", "renderer", "attachment");
const attachmentSource = join(repositoryRoot, "..", "src", "renderer", "attachment.ts");
const SOURCE_FILE = /\.ts$/u;
const FORBIDDEN_PATTERNS = [
  { expression: /Object\.assign\(\s*this\b/u, description: "owner-wide Object.assign" },
  {
    expression: /Object\.assign\(\s*(?:attachment|options\.attachment)\b/u,
    description: "attachment-owner Object.assign",
  },
  {
    expression:
      /(?:attachment|options\.attachment|this)\.(?:calls|transparentCalls|edgeCalls|nodeCalls|selectionCalls|selectedNodeCalls)\s*=/u,
    description: "direct draw-call publication",
  },
  {
    expression:
      /(?:attachment|options\.attachment|this)\.(?:interactionState|interactionBeforeLastInstanceUpdate|appliedHiddenIds|usesExteriorFaceSubsets)\s*=/u,
    description: "direct interaction-state publication",
  },
];

function collectSourceFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...collectSourceFiles(path));
    else if (entry.isFile() && SOURCE_FILE.test(entry.name)) files.push(path);
  }
  return files;
}

const violations = [];
for (const path of [attachmentSource, ...collectSourceFiles(attachmentRoot)]) {
  const source = readFileSync(path, "utf8");
  for (const { expression, description } of FORBIDDEN_PATTERNS) {
    if (
      path.endsWith("call-publication.ts") &&
      description === "direct interaction-state publication"
    )
      continue;
    if (expression.test(source))
      violations.push(`${relative(repositoryRoot, path)}: ${description}`);
  }
}

if (violations.length > 0) {
  console.error(violations.join("\n"));
  process.exit(1);
}
console.log("Attachment publication policy OK.");
