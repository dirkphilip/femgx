import { benchmarkCaseSpecs, createBenchmarkCase } from "./model";
import { measureBenchmarkCase } from "./measurement";
import type { WebGpuBenchmarkCaseResult, WebGpuBenchmarkReport } from "./types";

export type { WebGpuBenchmarkCaseResult, WebGpuBenchmarkReport } from "./types";

const WIDTH = 800;
const HEIGHT = 600;
const WARMUP_SAMPLES = 2;
const TIMED_SAMPLES = 7;
const MEMORY_ESTIMATE_SCOPE =
  "retained renderer-owned buffers and fixed render targets including inactive result-color tails; optional edge bytes are included only for materialized part ids; cpuSceneTypedArrayBytes and uploadStagingBytes are reported separately; driver allocations are excluded; edge and topology storage are upper bounds";

/** Runs the opt-in, hardware-dependent WebGPU capacity benchmark. */
export async function runWebGpuBenchmark(
  canvas: HTMLCanvasElement,
  options: { readonly includeLarge: boolean; readonly caseId?: string },
): Promise<WebGpuBenchmarkReport> {
  if (devicePixelRatio !== 1 && devicePixelRatio !== 2)
    throw new Error(`WebGPU benchmark requires DPR 1 or 2, got ${devicePixelRatio}`);
  const specs = benchmarkCaseSpecs(options.includeLarge);
  const selectedSpecs =
    options.caseId === undefined ? specs : specs.filter((spec) => spec.id === options.caseId);
  if (selectedSpecs.length === 0) {
    throw new Error(`Unknown WebGPU benchmark case: ${options.caseId ?? "<missing>"}`);
  }
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
  if (adapter === null) throw new Error("No WebGPU adapter is available for the benchmark");
  const timestampQueriesAvailable = adapter.features.has("timestamp-query");
  const device = timestampQueriesAvailable
    ? await adapter.requestDevice({ requiredFeatures: ["timestamp-query"] })
    : await adapter.requestDevice();
  const timestampQueriesEnabled = device.features.has("timestamp-query");
  const enabledFeatures = [...device.features].sort();
  canvas.style.width = `${WIDTH}px`;
  canvas.style.height = `${HEIGHT}px`;
  const results: WebGpuBenchmarkCaseResult[] = [];
  try {
    for (const spec of selectedSpecs) {
      let phase = "model build";
      try {
        const modelBuildStart = performance.now();
        const benchmarkCase = createBenchmarkCase(spec);
        phase = "runtime compile and measurement";
        results.push(
          await measureBenchmarkCase(
            canvas,
            device,
            benchmarkCase,
            performance.now() - modelBuildStart,
            { timestampQueriesRequested: timestampQueriesEnabled },
          ),
        );
      } catch (error) {
        const errorPhase =
          error instanceof Error &&
          "benchmarkPhase" in error &&
          typeof error.benchmarkPhase === "string"
            ? error.benchmarkPhase
            : phase;
        const cause = error instanceof Error && "cause" in error ? error.cause : error;
        throw benchmarkFailure(spec.id, errorPhase, cause);
      }
    }
  } finally {
    device.destroy();
  }
  const info = adapter.info;
  return {
    schemaVersion: 8,
    generatedAt: new Date().toISOString(),
    browser: navigator.userAgent,
    adapter: {
      vendor: info.vendor,
      architecture: info.architecture,
      device: info.device,
      description: info.description,
      isFallbackAdapter: info.isFallbackAdapter,
    },
    enabledFeatures,
    timestampQueries: {
      available: timestampQueriesAvailable,
      enabled: timestampQueriesEnabled,
      unit: results[0]?.gpuTimestamps.unit ?? "none",
      periodNs: results[0]?.gpuTimestamps.periodNs ?? null,
    },
    resolution: { width: WIDTH, height: HEIGHT, dpr: devicePixelRatio },
    memoryEstimateScope: MEMORY_ESTIMATE_SCOPE,
    warmupSamples: WARMUP_SAMPLES,
    timedSamples: TIMED_SAMPLES,
    cases: results,
  };
}

function benchmarkFailure(caseId: string, phase: string, error: unknown): Error {
  const detail = error instanceof Error ? error.message : String(error);
  return new Error(`${caseId} failed during ${phase}: ${detail}`, { cause: error });
}
