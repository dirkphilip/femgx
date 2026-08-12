export interface PackageSmokeCommandOutput {
  readonly stdout: string;
  readonly stderr: string;
}

export interface PackageSmokeFileEntry {
  readonly path: string;
}

export interface PackageSmokePackResult {
  readonly filename: string;
  readonly files: readonly PackageSmokeFileEntry[];
}

export function runCommand(
  command: string,
  args: readonly string[],
  cwd: string,
  env?: NodeJS.ProcessEnv,
): PackageSmokeCommandOutput;

export function parsePackResult(stdout: string, stderr?: string): PackageSmokePackResult;
