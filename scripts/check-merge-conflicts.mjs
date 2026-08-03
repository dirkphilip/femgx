import { execFileSync } from "node:child_process";

const CONFLICT_MARKER = "leftover conflict marker";

let output;
try {
  execFileSync("git", ["diff", "--cached", "--check"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
} catch (error) {
  output = `${error.stdout ?? ""}${error.stderr ?? ""}`;
}

if (output && output.includes(CONFLICT_MARKER)) {
  process.stderr.write(`pre-commit: unresolved merge conflict markers:\n${output}`);
  process.exit(1);
}
