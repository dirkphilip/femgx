import { readFileSync } from "node:fs";
import process from "node:process";

const pinnedVersion = readFileSync(new URL("../.nvmrc", import.meta.url), "utf8").trim();
const requiredMajor = Number.parseInt(pinnedVersion.replace(/^v/, "").split(".")[0] ?? "", 10);
const actualMajor = Number.parseInt(process.versions.node.split(".")[0] ?? "", 10);

if (!Number.isInteger(requiredMajor) || !Number.isInteger(actualMajor)) {
  console.error(
    `Unable to validate Node.js version (pinned: ${pinnedVersion}, actual: ${process.versions.node}).`,
  );
  process.exit(1);
}

if (actualMajor < requiredMajor) {
  console.error(
    `femgx requires Node.js ${requiredMajor} or newer; found ${process.versions.node} at ${process.execPath}. ` +
      `Activate the version pinned in .nvmrc before running npm commands.`,
  );
  process.exit(1);
}
