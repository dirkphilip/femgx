import type { Geometry, Part, PartId } from "../../geometry/part";
import type { GpuCostAdmission } from "../diagnostics/cost";
import type { DrawPipelines } from "../shaders/pipeline-builders";
import type {
  DrawCall,
  DrawCallContext,
  InstanceStorage,
  SelectionDrawRange,
} from "../resources/draw-resources";
import type { PipelineAdmissionCacheEntry } from "../resources/draw-types";

export type PipelinePass =
  "color" | "transparent" | "pick" | "selection-visible" | "selection-hidden";

export type DrawIntent =
  | {
      readonly kind: "surface";
      readonly pass: PipelinePass;
      readonly primitive?: "triangles" | "lines" | "points";
      /** Selects the exterior face order when it still represents displayed topology. */
      readonly surfaceSubset?: boolean | undefined;
    }
  | { readonly kind: "edge"; readonly pipeline: GPURenderPipeline }
  | { readonly kind: "edge-pick"; readonly pipeline: GPURenderPipeline }
  | {
      readonly kind: "nodes";
      readonly pipeline: GPURenderPipeline;
      readonly selection?: "visible" | "hidden";
    };

export interface DrawIntentState {
  readonly orderKind: "opaque" | "transparent" | "edge" | "node" | "selection" | "node-selection";
  readonly overlay: boolean;
  readonly edgePick: boolean;
  readonly nodes: boolean;
}

/** Resolves the smallest internal shader/resource path for one batch. */
export function pipelineAdmission(options: {
  readonly context: DrawCallContext;
  readonly storage: InstanceStorage;
  readonly call: DrawCall;
  readonly geometry: Geometry | undefined;
  readonly intent: DrawIntent;
  readonly cache: Map<PartId, PipelineAdmissionCacheEntry>;
}): GpuCostAdmission {
  const { context, storage, call, geometry, intent, cache } = options;
  const featureState = hasFeatureState(context, storage, call);
  if (intent.kind === "edge" || (intent.kind === "nodes" && intent.selection === undefined)) {
    return featureState ? "feature" : "topology";
  }
  if (intent.kind === "surface" && geometry?.primitive !== "triangles") {
    return intent.pass === "color" || intent.pass === "transparent"
      ? featureState
        ? "feature"
        : "topology"
      : "feature";
  }
  if (intent.kind !== "surface" || (intent.pass !== "color" && intent.pass !== "transparent")) {
    return "feature";
  }
  const cached = cache.get(call.partId);
  if (
    cached !== undefined &&
    cached.resultColors === context.resultColors &&
    cached.deformation === context.deformation &&
    cached.sectionPlane === context.sectionPlane &&
    cached.usesExteriorFaceSubsets === context.usesExteriorFaceSubsets &&
    cached.highlightOwned === storage.highlightOwned &&
    cached.minimalAvailable ===
      (context.minimalFrameBindGroup !== undefined && context.minimalInstanceLayout !== undefined)
  ) {
    return cached.admission;
  }
  const admission: GpuCostAdmission =
    context.minimalFrameBindGroup === undefined ||
    context.minimalInstanceLayout === undefined ||
    featureState
      ? "feature"
      : "minimal";
  cache.set(call.partId, {
    resultColors: context.resultColors,
    deformation: context.deformation,
    sectionPlane: context.sectionPlane,
    usesExteriorFaceSubsets: context.usesExteriorFaceSubsets,
    highlightOwned: storage.highlightOwned,
    minimalAvailable:
      context.minimalFrameBindGroup !== undefined && context.minimalInstanceLayout !== undefined,
    admission,
  });
  return admission;
}

function hasFeatureState(
  context: DrawCallContext,
  storage: InstanceStorage,
  call: DrawCall,
): boolean {
  return (
    context.sectionPlane !== undefined ||
    context.resultColors?.has(call.partId) === true ||
    context.deformation?.displacements.has(call.partId) === true ||
    !context.usesExteriorFaceSubsets ||
    storage.highlightOwned
  );
}

/** Selects the pipeline matching the admitted primitive and pass. */
export function pipelineFor(
  primitive: "triangles" | "lines" | "points",
  pass: PipelinePass,
  pipelines: DrawPipelines,
  admission: GpuCostAdmission = "feature",
): GPURenderPipeline {
  if (primitive === "triangles") {
    if (admission === "minimal" && pass === "color") return pipelines.minimalTrianglesColor;
    if (admission === "minimal" && pass === "transparent")
      return pipelines.minimalTrianglesTransparent;
    if (pass === "color") return pipelines.trianglesColor;
    if (pass === "transparent") return pipelines.trianglesTransparent;
    if (pass === "selection-visible") return pipelines.trianglesSelectionVisible;
    if (pass === "selection-hidden") return pipelines.trianglesSelectionHidden;
    return pipelines.trianglesPick;
  }
  if (primitive === "lines") {
    if (pass === "color") return pipelines.linesColor;
    if (pass === "transparent") return pipelines.linesTransparent;
    if (pass === "selection-visible") return pipelines.linesSelectionVisible;
    if (pass === "selection-hidden") return pipelines.linesSelectionHidden;
    return pipelines.linesPick;
  }
  if (pass === "color") return pipelines.pointsColor;
  if (pass === "transparent") return pipelines.pointsTransparent;
  if (pass === "selection-visible") return pipelines.pointsSelectionVisible;
  if (pass === "selection-hidden") return pipelines.pointsSelectionHidden;
  return pipelines.pointsPick;
}

/** Selects a surface pipeline or preserves a fixed overlay/picking pipeline. */
export function pipelineForIntent(
  intent: DrawIntent,
  geometry: Geometry | undefined,
  pipelines: DrawPipelines,
  admission: GpuCostAdmission,
): GPURenderPipeline {
  return intent.kind === "surface"
    ? pipelineFor(geometry?.primitive ?? "triangles", intent.pass, pipelines, admission)
    : intent.pipeline;
}

/** Maps a draw intent to its order sidecar and geometry resource requirements. */
export function drawIntentState(intent: DrawIntent): DrawIntentState {
  if (intent.kind === "nodes") {
    return {
      orderKind: intent.selection === undefined ? "node" : "node-selection",
      overlay: false,
      edgePick: false,
      nodes: true,
    };
  }
  if (intent.kind === "edge") {
    return { orderKind: "edge", overlay: true, edgePick: false, nodes: false };
  }
  if (intent.kind === "edge-pick") {
    return { orderKind: "opaque", overlay: true, edgePick: true, nodes: false };
  }
  return {
    orderKind:
      intent.pass === "transparent"
        ? "transparent"
        : intent.pass.startsWith("selection-")
          ? "selection"
          : "opaque",
    overlay: false,
    edgePick: false,
    nodes: false,
  };
}

/** Returns selection ranges only for surface selection passes. */
export function selectionRangesForIntent(
  call: DrawCall,
  intent: DrawIntent,
): readonly SelectionDrawRange[] | undefined {
  if (intent.kind !== "surface" || !intent.pass.startsWith("selection-")) return undefined;
  return call.selectionRanges;
}

/** Returns the requested primitive leaf for a selection range. */
export function geometryForPrimitive(
  geometries: readonly (Geometry | undefined)[],
  primitive: SelectionDrawRange["primitive"],
): Geometry | undefined {
  for (const geometry of geometries) {
    if (geometry?.primitive === primitive) return geometry;
  }
  return undefined;
}

/** Returns the primitive leaves represented by a draw intent. */
export function geometriesForIntent(
  part: Part,
  intent: DrawIntent,
): readonly (Geometry | undefined)[] {
  if (intent.kind === "nodes") return [undefined];
  if (intent.kind === "edge" || intent.kind === "edge-pick") {
    return part.geometries.filter((geometry) => geometry.primitive === "triangles");
  }
  if (intent.primitive === undefined) return part.geometries;
  return part.geometries.filter((geometry) => geometry.primitive === intent.primitive);
}
