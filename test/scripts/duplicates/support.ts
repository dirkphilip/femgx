import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tempDirs: string[] = [];

/** Creates a temporary source tree and retains it for test cleanup. */
export function makeRepo(files: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(join(tmpdir(), "check-duplicates-"));
  tempDirs.push(root);
  for (const [file, content] of Object.entries(files)) {
    const path = join(root, file);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, content);
  }
  return root;
}

/** Removes all temporary source trees created since the previous cleanup. */
export function cleanupRepos(): void {
  for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true });
}
