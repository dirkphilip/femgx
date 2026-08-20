import { spawnSync } from "node:child_process";

export interface CheckResult {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs a script check in its temporary repository and returns raw process output. */
export function runCheck(scriptPath: string, args: readonly string[], cwd: string): CheckResult {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd,
    encoding: "utf8",
  });
  return {
    status: result.status ?? -1,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}
