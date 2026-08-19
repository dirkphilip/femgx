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

/** Returns a retained cut-surface skin only for compatible surface passes. */
export function visibilitySkinForIntent(
  call: DrawCall,
  geometry: Geometry | undefined,
  intent: DrawIntent,
  state: Pick<DrawIntentState, "overlay" | "edgePick">,
): DrawCall["visibilitySkin"] {
  return geometry?.primitive === "triangles" &&
    !state.overlay &&
    !state.edgePick &&
    intent.kind === "surface" &&
    intent.pass !== "selection-visible"
    ? call.visibilitySkin
    : undefined;
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
  if (intent.kind === "edge" || (intent.kind === "nodes" && intent.selection === undefined)) {
    const featureState = hasFeatureState(context, storage, call, geometry);
    return featureState ? "feature" : "topology";
  }
  if (intent.kind === "surface" && geometry?.primitive !== "triangles") {
    const featureState = hasFeatureState(context, storage, call, geometry);
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
    cached.visibilitySkin === (call.visibilitySkin !== undefined) &&
    cached.highlightOwned === storage.highlightOwned &&
    cached.minimalAvailable ===
      (context.minimalFrameBindGroup !== undefined && context.minimalInstanceLayout !== undefined)
  ) {
    return cached.admission;
  }
  const featureState = hasFeatureState(context, storage, call, geometry);
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
    visibilitySkin: call.visibilitySkin !== undefined,
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
  geometry: Geometry | undefined,
): boolean {
  return (
    context.sectionPlane !== undefined ||
    hasPartBinding(context.resultColors, call.partId) ||
    hasPartBinding(context.deformation?.displacements, call.partId) ||
    call.visibilitySkin !== undefined ||
    !context.usesExteriorFaceSubsets ||
    storage.highlightOwned ||
    (geometry?.primitive === "triangles" && geometry.primitiveColors !== undefined)
  );
}

function hasPartBinding(
  bindings: ReadonlyMap<number | string, unknown> | undefined,
  partId: PartId,
): boolean {
  if (bindings?.has(partId) === true) return true;
  for (const binding of bindings?.keys() ?? []) if (typeof binding === "string") return true;
  return false;
}

/** Selects the pipeline matching the admitted primitive and pass. */
export function pipelineFor(
  primitive: "triangles" | "lines" | "points",
  pass: PipelinePass,
  pipelines: DrawPipelines,
  admission: GpuCostAdmission = "feature",
  denseSelection = false,
): GPURenderPipeline {
  if (primitive === "triangles") {
    if (admission === "minimal" && pass === "color") return pipelines.minimalTrianglesColor;
    if (admission === "minimal" && pass === "transparent")
      return pipelines.minimalTrianglesTransparent;
    if (pass === "color") {
      return denseSelection ? pipelines.denseSelectionTrianglesColor : pipelines.trianglesColor;
    }
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
  storage?: Pick<InstanceStorage, "highlight">,
): GPURenderPipeline {
  return intent.kind === "surface"
    ? pipelineFor(
        geometry?.primitive ?? "triangles",
        intent.pass,
        pipelines,
        admission,
        storage?.highlight.denseSelection !== undefined,
      )
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
