import type { InteractiveSamples } from "./interactive";
import type {
  WebGpuBenchmarkCase,
  WebGpuBenchmarkElementFamily,
  WebGpuBenchmarkKind,
} from "./model";
import type { BenchmarkMemoryEstimate } from "./memory";

export interface BenchmarkTimings {
  readonly uploadAttachmentEstimateMs: Percentiles;
  readonly uploadAndFirstFrameMs: Percentiles;
  readonly visibleFrameMs: Percentiles;
  readonly pickSnapshotEstimateMs: Percentiles;
  readonly pickSnapshotAndReadbackMs: Percentiles;
  readonly pickReadbackMs: Percentiles;
}

interface Percentiles {
  readonly p50: number;
  readonly p95: number;
}

export interface WebGpuBenchmarkCaseResult {
  readonly id: string;
  readonly name: string;
  readonly kind: WebGpuBenchmarkKind;
  readonly elementFamily: WebGpuBenchmarkElementFamily;
  readonly structuredFamily?: WebGpuBenchmarkCase["structuredFamily"];
  readonly partCount: number;
  readonly drawBatchCount: number;
  readonly bodyCount: number;
  readonly uniqueElementCount: number;
  readonly submittedElementOccurrences: number;
  readonly nodeCount: number;
  readonly faceCount: number;
  readonly uniqueVertices: number;
  readonly uniqueTriangles: number;
  readonly submittedTriangles: number;
  readonly visibleTriangles: number;
  readonly modelBuildMs: number;
  readonly runtimeCompileMs: number;
  readonly instanceCount: number;
  readonly timings: BenchmarkTimings;
  readonly interactive?: InteractiveSamples;
  readonly estimatedMemory: BenchmarkMemoryEstimate;
}

export interface WebGpuBenchmarkReport {
  readonly schemaVersion: 2;
  readonly generatedAt: string;
  readonly browser: string;
  readonly adapter: {
    readonly vendor: string;
    readonly architecture: string;
    readonly device: string;
    readonly description: string;
    readonly isFallbackAdapter: boolean;
  };
  readonly enabledFeatures: readonly string[];
  readonly resolution: { readonly width: number; readonly height: number; readonly dpr: number };
  readonly memoryEstimateScope: string;
  readonly warmupSamples: number;
  readonly timedSamples: number;
  readonly cases: readonly WebGpuBenchmarkCaseResult[];
}
