import {
  createScene,
  type Bounds,
  type Color,
  type PartId,
  type Scene,
  type ScalarField,
  type StyleOverride,
  type VectorField,
} from "../../../src/entries/root";
import type { ElementModel } from "../../../src/entries/model";
import type { Issue } from "../../../src/entries/io";
import type { ModelPreset } from "../../fixtures/presets";
import { sceneBounds } from "../../scene-bounds";
import {
  createBenchmarkCase,
  estimateBenchmarkMemory,
  type WebGpuBenchmarkElementFamily,
  type WebGpuBenchmarkSpec,
} from "../../benchmark/model";
import { reconstructBenchmarkScene } from "../../benchmark/transfer";
import { createBenchmarkWorkerLoad } from "../../benchmark/worker-client";

/** Build and transfer measurements retained for the Performance Lab diagnostics. */
export interface WorkbenchBenchmarkBuildTelemetry {
  readonly path: "main" | "worker";
  readonly requestId?: number;
  readonly generationMs?: number;
  readonly topologyMs?: number;
  readonly tessellationMs?: number;
  readonly transferPreparationMs?: number;
  readonly transferMs?: number;
  readonly mainReconstructionMs?: number;
  readonly transferredBytes?: number;
  readonly finalRetainedTypedBytes?: number;
}

export type WorkbenchPerformanceRetentionReason = "reused" | "evicted-over-budget" | "rebuild";

/** One demo-owned descriptor for built-in and locally opened display models. */
export interface WorkbenchModel {
  readonly id: string;
  readonly name: string;
  readonly source: "example" | "file";
  readonly scene: Scene;
  readonly elementModels: ReadonlyMap<PartId, ElementModel>;
  readonly partNames: ReadonlyMap<PartId, string>;
  readonly partStyles: ReadonlyMap<PartId, StyleOverride>;
  readonly bounds: Bounds;
  readonly results: ModelPreset["results"];
  readonly resultSequence?: ModelPreset["resultSequence"];
  readonly resultScalarFields?: readonly (ScalarField<"nodal"> | ScalarField<"elemental">)[];
  readonly resultVectorFields?: readonly VectorField<"elemental">[];
  readonly issues: readonly Issue[];
  readonly benchmarkElementFamily?: WebGpuBenchmarkElementFamily;
  /** Deterministic CPU-byte estimate used by the demo-private Performance Lab retention policy. */
  readonly estimatedCpuBytes?: number;
  /** Last Performance Lab retention outcome, shown only in development diagnostics. */
  readonly performanceRetentionReason?: WorkbenchPerformanceRetentionReason;
  /** Internal Performance Lab build accounting, absent for ordinary models. */
  readonly benchmarkBuildTelemetry?: WorkbenchBenchmarkBuildTelemetry;
  /** Builds an opt-in large model only after the user selects it. */
  readonly deferredLoad?: () => Promise<WorkbenchModel>;
  /** Cancels a demo-private deferred build owned by a worker. */
  readonly cancelDeferredLoad?: () => void;
  /** Subscribes to coarse phase changes from a demo-private deferred build. */
  readonly subscribeDeferredProgress?: (
    listener: (phase: "topology" | "tessellation") => void,
  ) => () => void;
}

/** Canonical demo data produced by a supported local model importer. */
export interface ImportedModelData {
  readonly scene: Scene;
  readonly elementModels: ReadonlyMap<PartId, ElementModel>;
  readonly partNames: ReadonlyMap<PartId, string>;
  readonly partStyles: ReadonlyMap<PartId, StyleOverride>;
  readonly bounds?: Bounds;
  readonly results: ModelPreset["results"];
  readonly resultScalarFields?: readonly (ScalarField<"nodal"> | ScalarField<"elemental">)[];
  readonly resultVectorFields?: readonly VectorField<"elemental">[];
  readonly issues: readonly Issue[];
}

/** Adapts an existing fixture to the common workbench model contract. */
export function createExampleModel(preset: ModelPreset): WorkbenchModel {
  const partStyles = new Map<PartId, StyleOverride>();
  for (const partId of preset.scene.parts.keys()) {
    const opacity = preset.partOpacities?.get(partId);
    partStyles.set(partId, {
      color: preset.partColors.get(partId) ?? preset.fallbackColor,
      ...(opacity === undefined ? {} : { opacity }),
    });
  }
  return {
    id: preset.id,
    name: preset.name,
    source: "example",
    scene: preset.scene,
    elementModels: preset.elementModels,
    partNames: preset.partNames,
    partStyles,
    bounds: preset.bounds,
    results: preset.results,
    ...(preset.resultSequence === undefined ? {} : { resultSequence: preset.resultSequence }),
    ...(preset.resultScalarFields === undefined
      ? {}
      : { resultScalarFields: preset.resultScalarFields }),
    ...(preset.resultVectorFields === undefined
      ? {}
      : { resultVectorFields: preset.resultVectorFields }),
    issues: [],
  };
}

/** Returns a selector entry whose bounded benchmark geometry is lazy. */
export function createLazyBenchmarkModel(spec: WebGpuBenchmarkSpec): WorkbenchModel {
  const placeholderScene = createSceneRuntimePlaceholder();
  const workerLoad = isWorkerBenchmarkSpec(spec)
    ? createBenchmarkWorkerLoad(spec, (result, transferMs) => {
        const reconstructionStart = performance.now();
        const reconstructed = reconstructBenchmarkScene(result.payload, spec.id);
        const mainReconstructionMs = performance.now() - reconstructionStart;
        return createBenchmarkModelFromScene(spec, reconstructed.scene, {
          path: "worker",
          requestId: result.requestId,
          ...result.metrics,
          transferMs,
          mainReconstructionMs,
          finalRetainedTypedBytes: reconstructed.finalRetainedTypedBytes,
        });
      })
    : undefined;
  return {
    id: spec.id,
    name: spec.name,
    source: "example",
    scene: placeholderScene,
    elementModels: new Map(),
    partNames: new Map(),
    partStyles: new Map(),
    bounds: placeholderBounds,
    results: undefined,
    issues: [],
    deferredLoad: workerLoad?.load ?? (() => Promise.resolve(createBenchmarkModel(spec))),
    ...(workerLoad === undefined
      ? {}
      : {
          cancelDeferredLoad: workerLoad.cancel,
          subscribeDeferredProgress: workerLoad.subscribeProgress,
        }),
  };
}

function createBenchmarkModel(spec: WebGpuBenchmarkSpec): WorkbenchModel {
  const benchmarkCase = createBenchmarkCase(spec);
  return createBenchmarkModelFromScene(spec, benchmarkCase.scene, { path: "main" });
}

function createBenchmarkModelFromScene(
  spec: WebGpuBenchmarkSpec,
  scene: Scene,
  benchmarkBuildTelemetry: WorkbenchBenchmarkBuildTelemetry,
): WorkbenchModel {
  const partStyles = new Map<PartId, StyleOverride>();
  const partNames = new Map<PartId, string>();
  for (const partId of scene.parts.keys()) {
    partStyles.set(partId, { color: benchmarkColor });
    partNames.set(partId, `${spec.name} · Part ${partId}`);
  }
  return {
    id: spec.id,
    name: spec.name,
    source: "example",
    scene,
    elementModels: new Map(),
    partNames,
    partStyles,
    bounds: sceneBounds(scene),
    results: undefined,
    issues: [],
    benchmarkElementFamily: spec.elementFamily,
    estimatedCpuBytes: estimateBenchmarkRetentionBytes(scene, spec.kind),
    benchmarkBuildTelemetry,
  };
}

/** Returns whether a benchmark belongs on the dense worker path. */
export function isWorkerBenchmarkSpec(spec: WebGpuBenchmarkSpec): boolean {
  return spec.kind === "structured-fe" && spec.structuredFamily === "tet4";
}

function estimateBenchmarkRetentionBytes(scene: Scene, kind: WebGpuBenchmarkSpec["kind"]): number {
  const typedArrayBytes = estimateBenchmarkMemory(scene, 0, 1, 1).cpuSceneTypedArrayBytes;
  const authoredElementCount = [...scene.parts.values()].reduce(
    (total, part) => total + (part.elements?.length ?? 0),
    0,
  );
  // Account for retained JS topology records that typed-array accounting cannot see.
  const elementRecordBytes = kind === "structured-fe" ? 3_072 : 208;
  return typedArrayBytes + authoredElementCount * elementRecordBytes;
}

/** Creates the active workbench descriptor for one imported local model file. */
export function createImportedModel(fileName: string, imported: ImportedModelData): WorkbenchModel {
  return {
    id: "opened-model",
    name: fileName,
    source: "file",
    scene: imported.scene,
    elementModels: imported.elementModels,
    partNames: imported.partNames,
    partStyles: imported.partStyles,
    bounds:
      imported.bounds ??
      sceneBounds(imported.scene, "Imported GLB scene must contain drawable geometry"),
    results: imported.results,
    ...(imported.resultScalarFields === undefined
      ? {}
      : { resultScalarFields: imported.resultScalarFields }),
    ...(imported.resultVectorFields === undefined
      ? {}
      : { resultVectorFields: imported.resultVectorFields }),
    issues: imported.issues,
  };
}

/** Resolves the part style while applying the workbench's display overlays. */
export function partStyleOverride(
  model: WorkbenchModel,
  partId: PartId,
  edges: boolean,
  nodes: boolean,
): StyleOverride {
  const authored = model.partStyles.get(partId) ?? { color: fallbackColor };
  const part = model.scene.parts.get(partId);
  return {
    ...authored,
    ...(edges ? { edge: true } : {}),
    ...(nodes && part?.geometries.some((geometry) => geometry.primitive !== "points")
      ? { nodes: true }
      : {}),
  };
}

/** Returns a safe display name for a browser-provided file name. */
export function displayFileName(name: string): string {
  const sanitized = name
    .split("")
    .filter((character) => {
      const code = character.charCodeAt(0);
      return character !== "\\" && character !== "/" && code >= 32 && code !== 127;
    })
    .join("")
    .trim()
    .slice(0, 120);
  return sanitized.length > 0 ? sanitized : "opened.model";
}

/** Formats bounded import feedback for the workbench status region. */
export function importFeedback(fileName: string, imported: ImportedModelData): string {
  const warnings = imported.issues.filter((issue) => issue.severity === "warning");
  if (warnings.length === 0) return `Opened ${fileName}.`;
  const first = warnings[0];
  return `Opened ${fileName} with ${warnings.length} warning${warnings.length === 1 ? "" : "s"}: ${first?.message ?? "ignored content"}`;
}

/** Returns an actionable string for an importer or file-reader failure. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const fallbackColor: Color = { r: 0.5, g: 0.5, b: 0.5, a: 1 };
const benchmarkColor: Color = { r: 0.2, g: 0.55, b: 0.9, a: 1 };
const placeholderBounds: Bounds = {
  minX: -0.5,
  minY: -0.5,
  minZ: -0.5,
  maxX: 0.5,
  maxY: 0.5,
  maxZ: 0.5,
};

function createSceneRuntimePlaceholder(): Scene {
  return createScene()
    .addAssembly({ id: 1, name: "lazy-benchmark-placeholder", placements: [] })
    .withRoot(1)
    .build();
}
