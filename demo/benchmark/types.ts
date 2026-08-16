import type { InteractiveSamples, OverlayInteractiveSamples } from "./interactive";
import type {
  WebGpuBenchmarkCase,
  WebGpuBenchmarkElementFamily,
  WebGpuBenchmarkKind,
} from "./model";
import type { BenchmarkMemoryEstimate } from "./memory";

export interface BenchmarkGpuTimestampPass {
  readonly sampleCount: number;
  readonly p50: number | null;
  readonly p95: number | null;
  readonly p99: number | null;
  readonly invalidSampleCount: number;
  readonly disjointSampleCount: number;
}

export interface BenchmarkGpuTimestampSnapshot {
  readonly available: boolean;
  readonly enabled: boolean;
  readonly unit: "nanoseconds" | "timestamp-ticks" | "none";
  readonly periodNs: number | null;
  readonly sampleCount: number;
  readonly invalidSampleCount: number;
  readonly disjointSampleCount: number;
  readonly passes: Readonly<Record<string, BenchmarkGpuTimestampPass>>;
}

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
  /** CPU-only first render, including resource creation and command encoding. */
  readonly uploadAndFirstFrameCpuMs: BenchmarkPercentiles;
  /** Queue-drained wall time; includes CPU encoding and GPU completion. */
  readonly visibleFrameMs: BenchmarkPercentiles;
  /** CPU-only `renderer.render()` and command encoding wall time. */
  readonly visibleFrameCpuMs: BenchmarkPercentiles;
  readonly pickSnapshotEstimateMs: BenchmarkPercentiles;
  readonly pickSnapshotAndReadbackMs: BenchmarkPercentiles;
  readonly pickReadbackMs: BenchmarkPercentiles;
}

export interface BenchmarkPercentiles {
  readonly p50: number;
  readonly p95: number;
}

export interface SelectionBenchmarkPhase {
  readonly id: "narrow" | "one-shell" | "broad" | "all-authored";
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
  /** Dense offset-table and per-occurrence bitset bytes for this selection. */
  readonly denseSelectionBytes: number;
  /** Comparison estimate if every selected target used a sparse record. */
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
  readonly overlayInteractive?: OverlayInteractiveSamples;
  readonly selection?: SelectionBenchmarkReport;
  readonly estimatedMemory: BenchmarkMemoryEstimate;
  /** Structural pass/draw/write counters from the final timed iteration. */
  readonly gpuCost: BenchmarkGpuCostSnapshot;
  /** Optional pass timestamps resolved from delayed benchmark readbacks. */
  readonly gpuTimestamps: BenchmarkGpuTimestampSnapshot;
  readonly presentation: {
    readonly nodeSizeCssPixels: number;
    readonly nodeSizeDevicePixels: number;
    readonly devicePixelRatio: number;
    readonly resolvedMsaaSampleCount: number;
    readonly projectionProxy: "camera-space point-size";
    readonly cpuProxy: "node draw calls and instances";
  };
}

export interface WebGpuBenchmarkReport {
  readonly schemaVersion: 8;
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
  readonly timestampQueries: {
    readonly available: boolean;
    readonly enabled: boolean;
    readonly unit: BenchmarkGpuTimestampSnapshot["unit"];
    readonly periodNs: number | null;
  };
  readonly resolution: { readonly width: number; readonly height: number; readonly dpr: number };
  readonly memoryEstimateScope: string;
  readonly warmupSamples: number;
  readonly timedSamples: number;
  readonly cases: readonly WebGpuBenchmarkCaseResult[];
}
