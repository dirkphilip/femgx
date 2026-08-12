import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const repositoryRoot = process.argv[2]
  ? resolve(process.argv[2])
  : resolve(import.meta.dirname, "..");

function git(...args) {
  return execFileSync("git", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
  }).trimEnd();
}

const status = git("status", "--short");
const diffStat = git("diff", "--stat", "HEAD");

console.log("Ready-to-commit review\n");
console.log(status || "Working tree clean.");
console.log("\nTracked diff from HEAD:");
console.log(diffStat || "No tracked changes.");
console.log(
  "\nBefore finishing, check for unnecessary code, duplication, obsolete paths, and weakened tests.",
);
