import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = process.argv[2]
  ? resolve(process.argv[2])
  : resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workflowsDirectory = join(repositoryRoot, ".github", "workflows");
const externalActionPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[0-9a-f]{40}$/iu;
const usesLinePattern = /^\s*(?:-\s*)?uses\s*:\s*(.*?)\s*$/u;

function actionReference(line) {
  const match = usesLinePattern.exec(line);
  if (!match) {
    return undefined;
  }

  return match[1]?.replace(/\s+#.*$/u, "").trim();
}

function findViolations() {
  let workflowFiles;
  try {
    workflowFiles = readdirSync(workflowsDirectory)
      .filter((file) => file.endsWith(".yml") || file.endsWith(".yaml"))
      .sort();
  } catch {
    return [];
  }

  const violations = [];
  for (const file of workflowFiles) {
    const path = join(workflowsDirectory, file);
    const lines = readFileSync(path, "utf8").split(/\r?\n/u);
    lines.forEach((line, index) => {
      const reference = actionReference(line);
      const isLocalAction = reference?.startsWith("./") ?? false;
      if (
        reference !== undefined &&
        (reference.length === 0 ||
          /\s/u.test(reference) ||
          (!isLocalAction && !externalActionPattern.test(reference)))
      ) {
        violations.push(
          `${relative(repositoryRoot, path)}:${index + 1}: external action reference must use a full 40-character commit SHA: ${reference}`,
        );
      }
    });
  }

  return violations;
}

const violations = findViolations();
if (violations.length > 0) {
  console.error(violations.join("\n"));
  process.exit(1);
}
