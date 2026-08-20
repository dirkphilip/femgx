import type { Part, PartId } from "../../geometry/part";
import type { InteractionState } from "../../interaction/interaction";
import type { PackedSceneRuntime } from "../../scene-runtime/runtime";
import type { GpuBundle } from "../recovery";
import type { InstanceLayout } from "../runtime-state";
import {
  destroyPartResource,
  type DrawResources,
  uploadGeometryPart,
} from "../resources/draw-resources";
import { syncDeformations } from "../frame/deformation";
import {
  destroyOrientationGlyphPart,
  syncOrientationGlyphs,
} from "../orientation-glyphs/orientation-glyph";
import { destroyResultColorBuffer, syncResultColors } from "../resources/result-colors";
import { destroyDeformationBuffer } from "../frame/deformation";
import type { PartRevisionResultState } from "./part-revision-results";
import type { AttachmentCallLists } from "./calls";
import type { HiddenInteractionTuple } from "./interaction";
import type { AttachmentFlagState } from "./reconciliation";
import type { SelectionState } from "../selection-state";

/**
 * Mutable attachment state shared with a transaction-local revision stage.
 * This structural boundary prevents attachment definitions from importing their owner.
 */
export interface PartRevisionAttachmentHost extends AttachmentCallLists {
  interactionState: InteractionState;
  interactionBeforeLastInstanceUpdate: InteractionState | undefined;
  readonly attachedParts: Map<PartId, Part>;
  readonly runtime: PackedSceneRuntime | undefined;
  layout: InstanceLayout | undefined;
  readonly selection: SelectionState;
  readonly slotByInstanceId: ReadonlyMap<string, number>;
  appliedHiddenIds: HiddenInteractionTuple;
  usesExteriorFaceSubsets: boolean;
  styleFlags(): AttachmentFlagState;
}

/** All allocations and CPU mirrors prepared before a definition revision commits. */
export interface PreparedPartRevision {
  readonly draw: DrawResources;
  readonly layout: InstanceLayout;
  readonly parts: Map<PartId, Part>;
  readonly flags: AttachmentFlagState;
  readonly interaction: InteractionState;
  readonly results: PartRevisionResultState | undefined;
}

/** Clones all fallible revised resources and interaction state before a live swap. */
export function prepareStagedPartRevision(options: {
  readonly attachment: PartRevisionAttachmentHost;
  readonly parts: Map<PartId, Part>;
  readonly partIds: ReadonlySet<PartId>;
  readonly interaction: InteractionState;
  readonly bundle: GpuBundle;
  readonly runtime: PackedSceneRuntime;
  readonly layout: InstanceLayout;
  readonly flags: AttachmentFlagState;
  readonly results: PartRevisionResultState | undefined;
}): PreparedPartRevision {
  const draw = stageDrawResources(options.bundle.draw, options.partIds);
  try {
    return stagePartRevision({ ...options, draw });
  } catch (error) {
    discardStagedPartResources(draw, options.bundle.draw, options.partIds);
    throw error;
  }
}

/** Copies the slot maps whose revision-local changes must never affect the live attachment. */
export function clonePartRevisionLayout(layout: InstanceLayout): InstanceLayout {
  return {
    ...layout,
    partVisibleCounts: new Map(layout.partVisibleCounts),
    partEdgeCounts: new Map(layout.partEdgeCounts),
    partNodeCounts: new Map(layout.partNodeCounts),
    partTransparentCounts: new Map(layout.partTransparentCounts),
    partSelectionCounts: new Map(layout.partSelectionCounts),
    partSelectedNodeCounts: new Map(layout.partSelectedNodeCounts),
    partSelectionDrawCalls: new Map(layout.partSelectionDrawCalls),
    partSurfaceDrawCalls: new Map(layout.partSurfaceDrawCalls),
  };
}

function stagePartRevision(options: {
  readonly attachment: PartRevisionAttachmentHost;
  readonly parts: Map<PartId, Part>;
  readonly partIds: ReadonlySet<PartId>;
  readonly interaction: InteractionState;
  readonly bundle: GpuBundle;
  readonly runtime: PackedSceneRuntime;
  readonly layout: InstanceLayout;
  readonly flags: AttachmentFlagState;
  readonly results: PartRevisionResultState | undefined;
  readonly draw: DrawResources;
}): PreparedPartRevision {
  stagePartGeometry(
    options.draw,
    options.parts,
    options.partIds,
    options.attachment.usesExteriorFaceSubsets,
  );
  stagePartResults(options);
  return options;
}

function stagePartResults(options: {
  readonly draw: DrawResources;
  readonly results: PartRevisionResultState | undefined;
  readonly runtime: PackedSceneRuntime;
  readonly layout: InstanceLayout;
}): void {
  const results = options.results;
  if (results === undefined) return;
  if (results.glyphs !== undefined)
    syncOrientationGlyphs(
      options.draw.orientationGlyphs,
      results.glyphs,
      options.runtime,
      options.layout,
    );
  if (results.deformation !== undefined)
    syncDeformations(options.draw, results.deformation, options.runtime, options.layout);
  if (results.colors !== undefined)
    syncResultColors(options.draw, results.colors, options.runtime, options.layout);
}

function stagePartGeometry(
  draw: DrawResources,
  parts: ReadonlyMap<PartId, Part>,
  partIds: ReadonlySet<PartId>,
  preferSubset: boolean,
): void {
  for (const partId of partIds) {
    const part = parts.get(partId);
    if (part === undefined) continue;
    for (const geometry of part.geometries) uploadGeometryPart(draw, part, geometry, preferSubset);
  }
}

function stageDrawResources(draw: DrawResources, partIds: ReadonlySet<PartId>): DrawResources {
  const staged = {
    ...draw,
    parts: new Map(draw.parts),
    primitiveParts: new Map(draw.primitiveParts),
    nodeParts: new Map(draw.nodeParts),
    storages: new Map(draw.storages),
    visibilitySkins: new Map(draw.visibilitySkins),
    admissionCache: new Map(draw.admissionCache),
    deformations: new Map(draw.deformations),
    resultColors: new Map(draw.resultColors),
    orientationGlyphs: {
      ...draw.orientationGlyphs,
      paramsData: draw.orientationGlyphs.paramsData.slice(0),
      parts: new Map(draw.orientationGlyphs.parts),
    },
  };
  for (const partId of partIds) {
    staged.parts.delete(partId);
    staged.primitiveParts.delete(partId);
    staged.nodeParts.delete(partId);
    staged.visibilitySkins.delete(partId);
    staged.admissionCache.delete(partId);
    staged.deformations.delete(partId);
    staged.resultColors.delete(partId);
    staged.orientationGlyphs.parts.delete(partId);
  }
  return staged;
}

function discardStagedPartResources(
  draw: DrawResources,
  live: DrawResources,
  partIds: ReadonlySet<PartId>,
): void {
  for (const partId of partIds) {
    destroyStagedGeometry(draw, partId);
    destroyPartResults(draw, partId);
  }
  if (draw.orientationGlyphs.paramsBuffer !== live.orientationGlyphs.paramsBuffer) {
    draw.orientationGlyphs.paramsBuffer?.destroy();
  }
}

/** Releases only geometry allocated by this stage; result-role maps remain live aliases. */
function destroyStagedGeometry(draw: DrawResources, partId: PartId): void {
  const primitives = draw.primitiveParts.get(partId);
  if (primitives !== undefined) {
    for (const resource of primitives.values()) destroyPartResource(resource);
    return;
  }
  const resource = draw.parts.get(partId);
  if (resource !== undefined) destroyPartResource(resource);
  const nodes = draw.nodeParts.get(partId);
  if (nodes !== undefined) destroyPartResource(nodes);
}

function destroyPartResults(draw: DrawResources, partId: PartId): void {
  destroyDeformationBuffer(draw.deformations, partId, draw.cost);
  destroyResultColorBuffer(draw, partId);
  destroyOrientationGlyphPart(draw.orientationGlyphs, partId);
}
