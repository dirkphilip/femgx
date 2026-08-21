import type {
  InteractiveSample,
  InteractiveSamples,
  OverlayInteractiveSamples,
} from "./interactive";
import type {
  WebGpuBenchmarkCase,
  WebGpuBenchmarkElementFamily,
  WebGpuBenchmarkKind,
} from "./model";
import type { BenchmarkMemoryEstimate } from "./memory";

/** Deterministic counts for semantic allocations retained by a dense Part. */
export interface DenseSemanticAllocationCounts {
  readonly elementDescriptors: number;
  readonly primitiveRangeArrays: number;
  readonly primitiveRangeDescriptors: number;
  readonly faceDescriptors: number;
  readonly faceNodeArrays: number;
  readonly faceNodeReferences: number;
  readonly faceKeyReferences: number;
  readonly faceSubsetReferences: number;
  readonly edgeDescriptors: number;
  readonly edgeNodeArrays: number;
  readonly edgeNodeReferences: number;
  readonly edgeIncidentElementReferences: number;
  readonly edgeFaceReferenceArrays: number;
  readonly edgeFaceReferences: number;
  readonly bodyDescriptors: number;
  readonly bodyElementReferences: number;
  readonly semanticIndex: {
    readonly elementEntries: number;
    readonly elementOrdinalEntries: number;
    readonly bodyEntries: number;
    readonly bodyByElementEntries: number;
    readonly faceEntries: number;
    readonly edgeEntries: number;
    readonly nodeTriangleFaceOffsetsBytes: number;
    readonly nodeTriangleFaceIdsBytes: number;
    readonly neighborTriangleFaceOffsetsBytes: number;
    readonly neighborTriangleFaceIdsBytes: number;
  };
}

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
  readonly memory: {
    readonly allocatedBytes: number;
    readonly releasedBytes: number;
    readonly bufferCreates: number;
    readonly bufferDestroys: number;
    readonly bindGroupInvalidations: number;
  };
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

export interface SelectionCameraTransition {
  /** Queue-drained first frame after moving the camera from an idle selection. */
  readonly firstFrameMs: number;
  readonly steadyFrameMs: BenchmarkPercentiles;
  /** CPU counters for that first camera frame; selection sync must remain zero. */
  readonly firstFrameCpu: Pick<
    BenchmarkGpuCostSnapshot["cpu"],
    "instance-scan" | "order-rebuild" | "call-rebuild"
  >;
}

export interface SelectionBenchmarkPhase {
  readonly id:
    | "narrow"
    | "one-shell"
    | "broad"
    | "one-authored"
    | "half-authored"
    | "all-but-one"
    | "all-authored";
  readonly returnedTargetCount: number;
  readonly selectedOccurrenceCount: number;
  /** Host target-object construction, separate from immutable state construction. */
  readonly targetConstructionMs: number;
  readonly invalidSnapshotMs: number;
  readonly cachedReadbackMs: number;
  readonly interactionStateMs: number;
  readonly interactionSyncMs: number;
  readonly interactionHighlightWriteBytes: number;
  readonly firstSelectedFrameMs: number;
  readonly cameraTransition: SelectionCameraTransition;
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

export interface NodeSelectionBenchmarkPhase {
  readonly id: "one" | "contiguous" | "fragmented" | "half" | "near-all" | "dense-boundary" | "all";
  readonly targetCount: number;
  readonly uniqueNodeCount: number;
  readonly selectedOccurrenceCount: number;
  /** Exact non-indexed vertices in one procedural node-sprite draw. */
  readonly selectedNodeDrawVertices: number;
  /** Exact flattened node-occurrence instances in one procedural node-sprite draw. */
  readonly selectedNodeDrawInstances: number;
  /** Number of selected-node draw calls in each visible or x-ray pass. */
  readonly selectedNodeCalls: number;
  /** Shared dense-occurrence or compact sparse-pair sidecar bytes. */
  readonly selectedNodeOrderBytes: number;
  /** Actual order-buffer bytes uploaded by the selection transition. */
  readonly selectedNodeOrderUploadBytes: number;
  readonly selectedNodeOrderUploadCalls: number;
  /** Immutable interaction-state construction wall time. */
  readonly interactionStateMs: number;
  /** CPU-only renderer interaction synchronization wall time. */
  readonly interactionSyncMs: number;
  /** Queue-drained first selected frame wall time. */
  readonly firstSelectedFrameMs: number;
  /** CPU encode/submit portion of the first selected frame. */
  readonly firstSelectedFrameCpuMs: number;
  readonly steadySelectedFrameMs: BenchmarkPercentiles;
  readonly movingSelectedFrameMs: BenchmarkPercentiles;
  /** Queue-drained clear transition wall time. */
  readonly clearSelectionMs: number;
  readonly interactionGpuCost: BenchmarkGpuCostSnapshot;
  /** Allocation and upload costs captured immediately after interaction synchronization. */
  readonly interactionSyncGpuCost: BenchmarkGpuCostSnapshot;
  /** Exact part-local slot table plus selected-occurrence node bitset bytes. */
  readonly denseNodePayloadBytes: number;
  /** Exact fresh highlight allocation containing this dense node payload. */
  readonly highlightStorageBytes: number;
  /** Comparison estimate if every selected target used a sparse record. */
  readonly selectedNodeRecordBytes: number;
}

export interface NodeSelectionBenchmarkReport {
  readonly selectedTargetGranularity: "node";
  /** Renderer-owned compact node-center storage, separate from topology ownership. */
  readonly nodeCenterBytes: number;
  /** Renderer-owned stable node-id storage, separate from topology ownership. */
  readonly nodeIdBytes: number;
  /** Renderer-owned node-sprite index storage; zero for procedural quads. */
  readonly nodeSpriteIndexBytes: 0;
  readonly phases: readonly NodeSelectionBenchmarkPhase[];
}

export interface HoverBenchmarkReport {
  readonly targetKind: "element";
  readonly selectedOccurrenceCount: 1;
  /** Pick snapshot and readback wall time before the hover transition. */
  readonly pickMs: number;
  readonly interactionStateMs: number;
  readonly interactionSyncMs: number;
  readonly interactionHighlightWriteBytes: number;
  readonly firstHoveredFrameMs: number;
  readonly steadyHoveredFrameMs: BenchmarkPercentiles;
  readonly clearHoverMs: number;
  readonly interactionGpuCost: BenchmarkGpuCostSnapshot;
}

export interface VisibilityBenchmarkPhase {
  readonly id: "one" | "half" | "all";
  readonly hiddenOccurrenceCount: number;
  readonly remainingVisibleTriangles: number;
  /** Submitted opaque surface indices after occurrence visibility is applied. */
  readonly visibleSurfaceSubmittedIndices: number;
  readonly runtimeMutationMs: number;
  readonly rendererSyncMs: number;
  readonly firstHiddenFrameMs: number;
  readonly steadyHiddenFrameMs: BenchmarkPercentiles;
  readonly restoreMs: number;
  /** Submitted opaque surface indices after all hidden occurrences are restored. */
  readonly restoredSurfaceSubmittedIndices: number;
  readonly hiddenGpuCost: BenchmarkGpuCostSnapshot;
}

export interface VisibilityBenchmarkReport {
  readonly phases: readonly VisibilityBenchmarkPhase[];
}

export interface SelectionHideWorkflowFrames {
  readonly firstFrameMs: number;
  readonly steadyFrameMs: BenchmarkPercentiles;
  readonly movingFirstFrameMs: number;
  readonly movingSteadyFrameMs: BenchmarkPercentiles;
}

export interface SelectionHideWorkflowPhase {
  /** Immutable selection or element-visibility state construction wall time. */
  readonly interactionStateMs: number;
  /** CPU-only renderer element-state synchronization wall time. */
  readonly interactionSyncMs: number;
  readonly frames: SelectionHideWorkflowFrames;
  /** Exact dense selection/visibility storage required by this interaction state. */
  readonly highlightRetainedBytes: number;
  /** Estimated retained topology buffers materialized for authored edge presentation. */
  readonly topologyRetainedBytes: number;
  /** Buffer allocation minus releases recorded while synchronizing this phase. */
  readonly rendererMemoryDeltaBytes: number;
}

export interface SelectionHideWorkflowVariant {
  readonly id: "unsectioned" | "active-section";
  readonly presentationGpuCost: BenchmarkGpuCostSnapshot;
  readonly presentationStateMs: number;
  readonly presentationSyncMs: number;
  readonly selection: SelectionHideWorkflowPhase;
  readonly hide: SelectionHideWorkflowPhase;
  readonly restoreStateMs: number;
  readonly restoreSyncMs: number;
  readonly restoredVisibleElementCount: number;
}

/** Real-WebGPU half-element select/hide workflow with node and edge presentation enabled. */
export interface SelectionHideWorkflowReport {
  readonly nodes: true;
  readonly authoredEdges: true;
  readonly selectedElementCount: number;
  readonly selectedOccurrenceCount: number;
  readonly variants: readonly SelectionHideWorkflowVariant[];
}

export interface ManyPieceInteractionPhase {
  readonly id: "one" | "half" | "all";
  readonly targetCount: number;
  /** Host target or override construction before immutable state construction. */
  readonly targetConstructionMs: number;
  readonly interactionStateMs: number;
  /** Stable occurrence-id to packed-slot resolution. */
  readonly changedSlotResolutionMs: number;
  readonly interactionSyncMs: number;
  readonly instanceWriteBytes: number;
  readonly firstFrameMs: number;
  readonly steadyFrameMs: BenchmarkPercentiles;
  readonly clearMs: number;
  readonly clearInstanceWriteBytes: number;
  readonly gpuCost: BenchmarkGpuCostSnapshot;
}

export interface ManyPieceBenchmarkReport {
  readonly selection: readonly ManyPieceInteractionPhase[];
  readonly recolor: readonly ManyPieceInteractionPhase[];
  readonly replacement: readonly ManyPieceReplacementPhase[];
}

export interface ManyPieceReplacementPhase {
  readonly id: "one" | "half" | "all";
  readonly changedOccurrenceCount: number;
  /** Immutable scene authoring snapshot, including its owning validation. */
  readonly sceneBuildIncludingValidationMs: number;
  readonly runtimeCompileMs: number;
  readonly rendererFirstFrameCpuMs: number;
  readonly queueDrainedFirstFrameMs: number;
  readonly instanceWriteBytes: number;
  readonly steadyFrameMs: BenchmarkPercentiles;
  readonly restoreMs: number;
  readonly restoreInstanceWriteBytes: number;
  readonly gpuCost: BenchmarkGpuCostSnapshot;
}

export interface CombinedOverlaySelectionSample {
  readonly targetCount: number;
  readonly targetConstructionMs: number;
  readonly interactionStateMs: number;
  readonly interactionSyncMs: number;
  readonly interactionHighlightWriteBytes: number;
  readonly firstSelectedFrameMs: number;
  readonly gpuCost: BenchmarkGpuCostSnapshot;
}

export interface CombinedOverlayBenchmarkReport {
  readonly nodes: true;
  readonly presentationEdges: true;
  /** Renderer-owned compact node-center storage, separate from topology ownership. */
  readonly nodeCenterBytes: number;
  /** Renderer-owned stable node-id storage, separate from topology ownership. */
  readonly nodeIdBytes: number;
  /** Renderer-owned node-sprite index storage; zero for procedural quads. */
  readonly nodeSpriteIndexBytes: 0;
  /** Exact non-indexed vertices in each procedural node-sprite draw. */
  readonly nodeDrawVertices: 4;
  /** Exact flattened node-occurrence instances in each procedural node-sprite draw. */
  readonly nodeDrawInstances: number;
  readonly coldNodeInteractionSyncMs: number;
  readonly coldNodeFirstFrameMs: number;
  readonly coldNodeFirstFrameCpuMs: number;
  readonly coldNodeGpuCost: BenchmarkGpuCostSnapshot;
  readonly coldEdgeInteractionSyncMs: number;
  readonly coldEdgeFirstFrameMs: number;
  readonly coldEdgeFirstFrameCpuMs: number;
  readonly coldEdgeGpuCost: BenchmarkGpuCostSnapshot;
  readonly estimatedRetainedEdgeBufferUpperBoundBytes: number;
  /** Exact dense edge-builder typed arrays allocated before finalization. */
  readonly edgeConstructionTypedArrayBytes?: number;
  /** Exact final CPU `MeshEdgeData` typed-array bytes. */
  readonly edgeFinalTypedArrayBytes?: number;
  /** Final data, builder state, and reused primitive ids live together during finalization. */
  readonly edgeGuaranteedTypedArrayOverlapBytes?: number;
  /** Construction plus final data when no dead intermediate is collected before return. */
  readonly edgeNoIntermediateGcTypedArrayUpperBoundBytes?: number;
  readonly materializedEdgePartCount: number;
  readonly fixedCamera: InteractiveSample;
  readonly movingCamera: InteractiveSample;
  readonly hover: HoverBenchmarkReport;
  readonly largeSelection: CombinedOverlaySelectionSample;
}

export interface DenseBenchmarkBuild {
  readonly generationMs: number;
  readonly topologyMs: number;
  readonly tessellationMs: number;
  readonly transferPreparationMs: number;
  readonly workerRoundTripMs: number;
  readonly mainReconstructionMs: number;
  readonly transferredBytes: number;
  readonly finalRetainedTypedBytes: number;
  /** Deterministic semantic allocation counts; JS object bytes are not inferred. */
  readonly semanticAllocationCounts: DenseSemanticAllocationCounts;
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
  readonly denseBuild?: DenseBenchmarkBuild;
  readonly runtimeCompileMs: number;
  /** Renderer/device-owned setup before any scene geometry attachment or upload. */
  readonly rendererCreateMs: number;
  readonly instanceCount: number;
  readonly timings: BenchmarkTimings;
  readonly interactive?: InteractiveSamples;
  readonly overlayInteractive?: OverlayInteractiveSamples;
  readonly selection?: SelectionBenchmarkReport;
  readonly nodeSelection?: NodeSelectionBenchmarkReport;
  readonly hover?: HoverBenchmarkReport;
  readonly visibility?: VisibilityBenchmarkReport;
  readonly selectionHideWorkflow?: SelectionHideWorkflowReport;
  readonly manyPiece?: ManyPieceBenchmarkReport;
  readonly combinedOverlay?: CombinedOverlayBenchmarkReport;
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
  readonly schemaVersion: 12;
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
