import { spawnSync } from "node:child_process";

/** Runs one package-smoke subprocess with captured output and explicit failure details. */
export function runCommand(command, args, cwd, env = process.env) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  if (result.error !== undefined || result.status !== 0) {
    throw new Error(
      formatCommandFailure({
        command,
        args,
        status: result.status,
        stdout,
        stderr,
        error: result.error,
      }),
    );
  }
  return { stdout, stderr };
}

/** Validates npm pack's exact JSON contract and returns its one pack result. */
export function parsePackResult(stdout, stderr = "") {
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch (error) {
    throw new Error(
      `npm pack did not produce valid JSON: ${errorMessage(error)}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
      { cause: error },
    );
  }
  if (!Array.isArray(parsed) || parsed.length !== 1) {
    throw new Error(
      `npm pack must produce exactly one JSON result\nstdout:\n${stdout}\nstderr:\n${stderr}`,
    );
  }
  const result = parsed[0];
  if (
    result === null ||
    typeof result !== "object" ||
    typeof result.filename !== "string" ||
    result.filename.length === 0
  ) {
    throw new Error(
      `npm pack result is missing a non-empty filename\nstdout:\n${stdout}\nstderr:\n${stderr}`,
    );
  }
  if (!Array.isArray(result.files)) {
    throw new Error(
      `npm pack result is missing its files array\nstdout:\n${stdout}\nstderr:\n${stderr}`,
    );
  }
  return result;
}

function formatCommandFailure({ command, args, status, stdout, stderr, error }) {
  return [
    `Command failed: ${[command, ...args].join(" ")}`,
    `exit status: ${String(status ?? "spawn-error")}`,
    error === undefined ? "" : `error: ${error.message}`,
    `stdout:\n${stdout}`,
    `stderr:\n${stderr}`,
  ]
    .filter((line) => line.length > 0)
    .join("\n");
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
