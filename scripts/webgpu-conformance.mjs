import { appendFile, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

export const CONFORMANCE_TARGETS = [
  {
    id: "apple",
    name: "Apple",
    runnerLabel: "femgx-webgpu-apple",
  },
  {
    id: "windows-nvidia",
    name: "Windows / NVIDIA",
    runnerLabel: "femgx-webgpu-nvidia",
  },
];

const softwareAdapterPattern = /swiftshader|llvmpipe|lavapipe|software/iu;
const requiredAssertions = [
  "perspective",
  "scalarColors",
  "selectedAndHighlighted",
  "transparency",
  "sectionCaps",
  "picking",
  "orientationGizmo",
];

/** Maps requested targets to online labelled runners or explicit unavailable jobs. */
export function conformanceRunnerMatrix(runners, requested) {
  return CONFORMANCE_TARGETS.map((target) => {
    if (!requested.includes(target.id)) {
      return {
        target: target.id,
        name: target.name,
        runner: "ubuntu-latest",
        state: "not-requested",
      };
    }
    const available = runners.some(
      (runner) =>
        runner.status === "online" &&
        runner.labels.some((label) => label.name === target.runnerLabel),
    );
    return {
      target: target.id,
      name: target.name,
      runner: available ? target.runnerLabel : "ubuntu-latest",
      state: available ? "available" : "unavailable",
    };
  });
}

/** Produces a cross-vendor correctness summary and the targets lacking valid evidence. */
export function summarizeConformance(evidenceRecords, requiredTargets) {
  const rows = [];
  const missing = [];
  for (const target of CONFORMANCE_TARGETS) {
    if (!requiredTargets.includes(target.id)) {
      rows.push({ target: target.name, status: "not requested", identity: "—", captures: "—" });
      continue;
    }
    const evidence = latestEvidence(evidenceRecords, target.id);
    if (evidence === undefined) {
      missing.push(target.id);
      rows.push({ target: target.name, status: "unavailable", identity: "—", captures: "—" });
      continue;
    }
    const error = evidenceError(evidence, target.id);
    if (error !== undefined) {
      missing.push(target.id);
      rows.push({
        target: target.name,
        status: `invalid: ${error}`,
        identity: evidenceIdentity(evidence),
        captures: "—",
      });
      continue;
    }
    rows.push({
      target: target.name,
      status: "conformant",
      identity: evidenceIdentity(evidence),
      captures: evidence.captures.map((capture) => capture.name).join(", "),
    });
  }
  const lines = [
    "## Hardware WebGPU conformance",
    "",
    "| Target | Status | Browser / adapter | Captures |",
    "| --- | --- | --- | --- |",
    ...rows.map((row) => `| ${row.target} | ${row.status} | ${row.identity} | ${row.captures} |`),
    "",
    "This lane compares deterministic correctness evidence only; it does not compare frame rates.",
  ];
  return { markdown: `${lines.join("\n")}\n`, missing };
}

function latestEvidence(records, target) {
  return records
    .filter((record) => record.target === target)
    .sort((left, right) => String(right.capturedAt).localeCompare(String(left.capturedAt)))[0];
}

function evidenceError(evidence, target) {
  if (evidence.kind !== "hardware-webgpu-conformance" || evidence.schemaVersion !== 1) {
    return "unsupported evidence schema";
  }
  const adapterText = `${evidence.adapter?.vendor ?? ""} ${evidence.adapter?.device ?? ""} ${evidence.adapter?.description ?? ""}`;
  if (evidence.adapter?.isFallbackAdapter !== false || softwareAdapterPattern.test(adapterText)) {
    return "software or fallback adapter";
  }
  if (target === "apple" && (evidence.platform !== "darwin" || !/apple/iu.test(adapterText))) {
    return "expected Apple hardware on macOS";
  }
  if (
    target === "windows-nvidia" &&
    (evidence.platform !== "win32" || !/nvidia/iu.test(adapterText))
  ) {
    return "expected NVIDIA hardware on Windows";
  }
  if (!requiredAssertions.every((name) => evidence.assertions?.[name] === true)) {
    return "journey assertion missing";
  }
  const captureNames = new Set((evidence.captures ?? []).map((capture) => capture.name));
  if (!captureNames.has("desktop") || !captureNames.has("mobile-390x844")) {
    return "desktop or mobile capture missing";
  }
  return undefined;
}

function evidenceIdentity(evidence) {
  const browser = `${evidence.browser?.name ?? "unknown"} ${evidence.browser?.version ?? "unknown"}`;
  const adapter = [
    evidence.adapter?.vendor,
    evidence.adapter?.architecture,
    evidence.adapter?.device,
  ]
    .filter(Boolean)
    .join(" ");
  return `${browser}; ${adapter || "unknown adapter"}`;
}

async function readEvidence(directory) {
  const records = [];
  for (const path of await filesNamed(directory, "hardware-conformance.json")) {
    records.push(JSON.parse(await readFile(path, "utf8")));
  }
  return records;
}

async function filesNamed(directory, name) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const paths = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) paths.push(...(await filesNamed(path, name)));
    else if (entry.isFile() && entry.name === name) paths.push(path);
  }
  return paths;
}

function requestedTargets() {
  return CONFORMANCE_TARGETS.filter((target) => {
    const environmentName = `REQUEST_${target.id.replaceAll("-", "_").toUpperCase()}`;
    return process.env[environmentName] === "true";
  }).map((target) => target.id);
}

async function appendEnvironmentFile(name, content) {
  const path = process.env[name];
  if (path !== undefined) await appendFile(path, content, "utf8");
}

async function main() {
  const [command, path] = process.argv.slice(2);
  if (command === "plan") {
    const runners = JSON.parse(await readFile(path, "utf8")).runners ?? [];
    const requested = requestedTargets();
    const matrix = conformanceRunnerMatrix(runners, requested);
    await appendEnvironmentFile("GITHUB_OUTPUT", `matrix=${JSON.stringify({ include: matrix })}\n`);
    await appendEnvironmentFile("GITHUB_OUTPUT", `required=${requested.join(",")}\n`);
    const planned = matrix.map((entry) => `- ${entry.name}: ${entry.state}`).join("\n");
    await appendEnvironmentFile("GITHUB_STEP_SUMMARY", `## Hardware runner plan\n\n${planned}\n`);
    return;
  }
  if (command === "summary") {
    const required = (process.env.FEMGX_CONFORMANCE_REQUIRE ?? "").split(",").filter(Boolean);
    const summary = summarizeConformance(await readEvidence(path), required);
    process.stdout.write(summary.markdown);
    await appendEnvironmentFile("GITHUB_STEP_SUMMARY", summary.markdown);
    if (summary.missing.length > 0) process.exitCode = 1;
    return;
  }
  throw new Error("usage: webgpu-conformance.mjs plan <runners.json> | summary <evidence-dir>");
}

if (process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
