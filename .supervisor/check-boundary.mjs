import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const automationRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = dirname(automationRoot);
const trackedPaths = execFileSync("git", ["ls-files", "-z"], {
  cwd: repositoryRoot,
  encoding: "utf8",
})
  .split("\0")
  .filter(Boolean);
const violations = [];

for (const relativePath of trackedPaths) {
  if (relativePath === ".supervisor" || relativePath.startsWith(".supervisor/")) continue;
  if (!existsSync(join(repositoryRoot, relativePath))) continue;

  if (/supervisor/i.test(relativePath)) {
    violations.push(`path: ${relativePath}`);
  }

  let content;
  try {
    content = readFileSync(join(repositoryRoot, relativePath), "utf8");
  } catch {
    continue;
  }
  content.split(/\r?\n/).forEach((line, index) => {
    if (/supervisor/i.test(line)) violations.push(`content: ${relativePath}:${index + 1}: ${line}`);
  });
}

if (violations.length > 0) {
  console.error("Automation boundary audit failed:");
  for (const violation of violations) console.error(violation);
  process.exitCode = 1;
} else {
  console.log("Automation boundary audit passed.");
}
