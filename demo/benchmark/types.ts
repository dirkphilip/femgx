import type { InteractiveSamples } from "./interactive";
import type {
  WebGpuBenchmarkCase,
  WebGpuBenchmarkElementFamily,
  WebGpuBenchmarkKind,
} from "./model";
import type { BenchmarkMemoryEstimate } from "./memory";

export interface BenchmarkGpuCostSnapshot {
  readonly passes: Readonly<Record<string, number>>;
  readonly draws: Readonly<
    Record<string, { readonly calls: number; readonly indices: number; readonly instances: number }>
  >;
  readonly writes: Readonly<Record<string, { readonly calls: number; readonly bytes: number }>>;
  readonly cpu: Readonly<Record<string, number>>;
  readonly targets:
    | {
        readonly width: number;
        readonly height: number;
        readonly devicePixelRatio: number;
        readonly sampleCount: number;
        readonly weightedTransparency: boolean;
        readonly estimatedBytes: number;
      }
    | undefined;
}

export interface BenchmarkTimings {
  readonly uploadAttachmentEstimateMs: BenchmarkPercentiles;
  readonly uploadAndFirstFrameMs: BenchmarkPercentiles;
  readonly visibleFrameMs: BenchmarkPercentiles;
  readonly pickSnapshotEstimateMs: BenchmarkPercentiles;
  readonly pickSnapshotAndReadbackMs: BenchmarkPercentiles;
  readonly pickReadbackMs: BenchmarkPercentiles;
}

export interface BenchmarkPercentiles {
  readonly p50: number;
  readonly p95: number;
}

export interface SelectionBenchmarkPhase {
  readonly id: "narrow" | "one-shell" | "broad";
  readonly returnedTargetCount: number;
  readonly selectedOccurrenceCount: number;
  readonly invalidSnapshotMs: number;
  readonly cachedReadbackMs: number;
  readonly interactionStateMs: number;
  readonly interactionSyncMs: number;
  readonly firstSelectedFrameMs: number;
  readonly steadySelectedFrameMs: BenchmarkPercentiles;
  readonly clearSelectionMs: number;
  readonly interactionGpuCost: BenchmarkGpuCostSnapshot;
  readonly selectedElementRecordBytes: number;
}

export interface SelectionBenchmarkReport {
  readonly selectedTargetGranularity: "element";
  readonly phases: readonly SelectionBenchmarkPhase[];
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
  readonly selection?: SelectionBenchmarkReport;
  readonly estimatedMemory: BenchmarkMemoryEstimate;
  /** Structural pass/draw/write counters from the final timed iteration. */
  readonly gpuCost: BenchmarkGpuCostSnapshot;
}

export interface WebGpuBenchmarkReport {
  readonly schemaVersion: 4;
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
