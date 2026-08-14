import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import {
  chmod,
  copyFile,
  mkdtemp,
  mkdir,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const version = "1.7.12";
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workflowsDirectory = join(repositoryRoot, ".github", "workflows");
const checksums = {
  darwin_amd64: "5b44c3bc2255115c9b69e30efc0fecdf498fdb63c5d58e17084fd5f16324c644",
  darwin_arm64: "aba9ced2dee8d27fecca3dc7feb1a7f9a52caefa1eb46f3271ea66b6e0e6953f",
  linux_amd64: "8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8",
  linux_arm64: "325e971b6ba9bfa504672e29be93c24981eeb1c07576d730e9f7c8805afff0c6",
};

function platformTarget() {
  const platform = { darwin: "darwin", linux: "linux" }[process.platform];
  const architecture = { arm64: "arm64", x64: "amd64" }[process.arch];
  if (platform === undefined || architecture === undefined) {
    throw new Error("actionlint validation supports macOS/Linux on x64/arm64 only");
  }
  return `${platform}_${architecture}`;
}

async function downloadArchive(url, path, expectedChecksum) {
  const response = await globalThis.fetch(url);
  if (!response.ok) {
    throw new Error(`could not download actionlint: HTTP ${response.status}`);
  }
  const archive = Buffer.from(await response.arrayBuffer());
  const actualChecksum = createHash("sha256").update(archive).digest("hex");
  if (actualChecksum !== expectedChecksum) {
    throw new Error(
      `actionlint checksum mismatch: expected ${expectedChecksum}, got ${actualChecksum}`,
    );
  }
  await writeFile(path, archive);
}

async function actionlintExecutable() {
  const target = platformTarget();
  const archiveName = `actionlint_${version}_${target}.tar.gz`;
  const cacheDirectory = join(repositoryRoot, ".cache", "actionlint", version, target);
  const executable = join(cacheDirectory, "actionlint");
  try {
    await stat(executable);
    return executable;
  } catch {
    // Download into a temporary directory, then publish the verified binary atomically.
  }

  await mkdir(cacheDirectory, { recursive: true });
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "femgx-actionlint-"));
  const archivePath = join(temporaryDirectory, archiveName);
  const stagedExecutable = join(cacheDirectory, `.actionlint-${process.pid}`);
  try {
    const url = `https://github.com/rhysd/actionlint/releases/download/v${version}/${archiveName}`;
    await downloadArchive(url, archivePath, checksums[target]);
    const extracted = spawnSync("tar", ["-xzf", archivePath, "-C", temporaryDirectory], {
      encoding: "utf8",
    });
    if (extracted.error !== undefined || extracted.status !== 0) {
      throw new Error(`could not extract actionlint archive: ${extracted.stderr.trim()}`);
    }
    await stat(join(temporaryDirectory, "actionlint"));
    await copyFile(join(temporaryDirectory, "actionlint"), stagedExecutable);
    await chmod(stagedExecutable, 0o755);
    await rename(stagedExecutable, executable);
    return executable;
  } finally {
    await rm(stagedExecutable, { force: true });
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function workflowFiles(arguments_) {
  const paths =
    arguments_.length > 0
      ? arguments_.map((file) => resolve(repositoryRoot, file))
      : (await readdir(workflowsDirectory))
          .filter((file) => /\.(?:yml|yaml)$/u.test(file))
          .map((file) => join(workflowsDirectory, file));
  return paths
    .filter((file) => file.startsWith(`${workflowsDirectory}/`))
    .map((file) => relative(repositoryRoot, file));
}

async function main() {
  const files = await workflowFiles(process.argv.slice(2));
  if (files.length === 0) {
    throw new Error("no GitHub Actions workflow files were found");
  }
  const executable = await actionlintExecutable();
  const result = spawnSync(executable, ["-shellcheck=", "-pyflakes=", ...files], {
    cwd: repositoryRoot,
    stdio: "inherit",
  });
  if (result.error !== undefined) throw result.error;
  process.exitCode = result.status ?? 1;
}

main().catch((error) => {
  console.error(`actionlint: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
