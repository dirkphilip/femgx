import type { Part, PartId } from "../../geometry/part";
import type { InteractionState } from "../../interaction/interaction";
import type { PackedSceneRuntime } from "../../scene-runtime/runtime";
import type { RuntimeOccurrenceDelta } from "../../scene-runtime/occurrence-update";
import type { PartOccurrence, PartOccurrenceId } from "../../scene/types";
import type { GpuBundle } from "../recovery";
import type { InstanceLayout } from "../runtime-state";
import {
  rebuildAttachmentOrders,
  type AttachmentFlagState,
  type AttachmentState,
} from "./reconciliation";
import { applyOccurrenceAttachment, releasePartDefinitions } from "./occurrences";
import { syncOccurrenceInteractionEmphasis } from "./interaction";
import {
  PartRevisionMap,
  stagePartRevisionArray,
  stagePartRevisionFlagSet,
  type PartRevisionFlagSet,
} from "./part-revision-overlay";
import { stageDrawResources } from "./part-revision-stage";
import { discardStagedOccurrenceResources } from "./occurrence-resources";
import {
  commitStagedPartResults,
  commitStagedStorage,
  commitStagedWrites,
} from "./part-definitions";
import type { PartRevisionResultState } from "./part-revision-results";
import { syncDeformations } from "../frame/deformation";
import { syncOrientationGlyphs } from "../orientation-glyphs/orientation-glyph";
import { syncResultColors } from "../resources/result-colors";
import type { DrawResources } from "../resources/draw-resources";
import type { StagedBufferWrite } from "./part-revision-writes";
import type { AttachmentCallLists } from "./calls";

interface OccurrenceAttachmentOwner extends AttachmentCallLists {
  readonly runtime: PackedSceneRuntime | undefined;
  readonly layout: InstanceLayout | undefined;
  readonly instances: Array<PartOccurrence | undefined>;
  readonly slotByInstanceId: Map<PartOccurrenceId, number>;
  readonly attachedParts: Map<PartId, Part>;
  interactionState: InteractionState;
  interactionBeforeLastInstanceUpdate: InteractionState | undefined;
  styleFlags(): AttachmentFlagState;
}

interface StagedSlotLocals {
  readonly values: Int32Array;
  commit(target: InstanceLayout): void;
}

/** Detached renderer placement state whose GPU allocations are complete. */
export interface PreparedAttachmentOccurrenceUpdate {
  readonly draw: DrawResources;
  readonly layout: InstanceLayout;
  readonly parts: PartRevisionMap<PartId, Part>;
  readonly sourceParts: PartRevisionMap<PartId, Part>;
  readonly interaction: InteractionState;
  readonly results: PartRevisionResultState | undefined;
  commit(): void;
  discard(): void;
}

/** Prepares exact placement, presentation, and result writes without mutating live owners. */
export function prepareAttachmentOccurrenceUpdate(options: {
  readonly attachment: OccurrenceAttachmentOwner;
  readonly runtime: PackedSceneRuntime;
  readonly interaction: InteractionState;
  readonly delta: RuntimeOccurrenceDelta;
  readonly sourceParts: Map<PartId, Part>;
  readonly parts: ReadonlyMap<PartId, Part>;
  readonly bundle: GpuBundle;
  readonly results?: PartRevisionResultState;
}): PreparedAttachmentOccurrenceUpdate {
  const liveLayout = options.attachment.layout;
  if (options.attachment.runtime !== options.runtime || liveLayout === undefined)
    throw new Error("Occurrence revisions require the attached renderer runtime");
  const partIds = options.delta.affectedPartIds;
  const flags = stagePartRevisionFlagSet(options.attachment.styleFlags());
  const instances = stagePartRevisionArray(options.attachment.instances);
  const slotByInstanceId = new PartRevisionMap(options.attachment.slotByInstanceId);
  const sourceParts = new PartRevisionMap(options.sourceParts);
  const attachedParts = new PartRevisionMap(options.attachment.attachedParts);
  stageAddedParts(options.parts, options.delta.addedPartIds, sourceParts, attachedParts);
  const slotLocals = stageSlotLocals(liveLayout.slotPartLocal);
  const layout = stageOccurrenceLayout(liveLayout, slotLocals.values, partIds);
  const staged = stageDrawResources(options.bundle.draw, partIds, true, false);
  let completed = false;
  try {
    const calls = stageOccurrenceChanges({
      ...options,
      layout,
      flags,
      instances,
      slotByInstanceId,
      attachedParts,
      draw: staged.draw,
    });
    stageResults(staged.draw, options.results, options.runtime, layout, partIds);
    return preparedUpdate({
      ...options,
      calls,
      flags,
      instances,
      slotByInstanceId,
      slotLocals,
      layout,
      liveSourceParts: options.sourceParts,
      sourceParts,
      attachedParts,
      draw: staged.draw,
      writes: staged.writes,
      complete: () => {
        completed = true;
      },
      completed: () => completed,
    });
  } catch (error) {
    discardStagedOccurrenceResources(staged.draw, options.bundle.draw, partIds);
    throw error;
  }
}

function stageOccurrenceChanges(options: {
  readonly attachment: OccurrenceAttachmentOwner;
  readonly runtime: PackedSceneRuntime;
  readonly interaction: InteractionState;
  readonly delta: RuntimeOccurrenceDelta;
  readonly bundle: GpuBundle;
  readonly layout: InstanceLayout;
  readonly flags: PartRevisionFlagSet;
  readonly instances: ReturnType<typeof stagePartRevisionArray<PartOccurrence | undefined>>;
  readonly slotByInstanceId: PartRevisionMap<string, number>;
  readonly attachedParts: ReadonlyMap<PartId, Part>;
  readonly draw: DrawResources;
}) {
  const state: AttachmentState = {
    flags: options.flags.values,
    instances: options.instances.values,
    slotByInstanceId: options.slotByInstanceId,
  };
  const optionalParts = applyOccurrenceAttachment({
    runtime: options.runtime,
    layout: options.layout,
    delta: options.delta,
    interaction: options.interaction,
    state,
    draw: options.draw,
  });
  const bundle = { ...options.bundle, device: options.draw.device, draw: options.draw };
  syncOccurrenceInteractionEmphasis({
    runtime: options.runtime,
    layout: options.layout,
    interaction: options.interaction,
    parts: options.attachedParts,
    bundle,
    transparentFlags: options.flags.values.transparentFlags,
    slotByInstanceId: options.slotByInstanceId,
    changedSlots: options.delta.slots.map(({ slot }) => slot),
    affectedParts: options.delta.affectedPartIds,
  });
  return rebuildAttachmentOrders({
    runtime: options.runtime,
    layout: options.layout,
    parts: options.delta.affectedPartIds,
    flags: options.flags.values,
    interaction: options.interaction,
    partDefinitions: options.attachedParts,
    selection: {
      selectedNodeFlags: options.flags.values.selectedNodeFlags,
      nodeFlags: options.flags.values.nodeFlags,
    },
    bundle,
    optionalParts,
    previousCalls: options.attachment,
  });
}

type PreparedOptions = Parameters<typeof prepareAttachmentOccurrenceUpdate>[0] & {
  readonly calls: Pick<
    AttachmentCallLists,
    | "calls"
    | "transparentCalls"
    | "edgeCalls"
    | "nodeCalls"
    | "selectionCalls"
    | "selectedNodeCalls"
  >;
  readonly flags: PartRevisionFlagSet;
  readonly instances: ReturnType<typeof stagePartRevisionArray<PartOccurrence | undefined>>;
  readonly slotByInstanceId: PartRevisionMap<string, number>;
  readonly slotLocals: StagedSlotLocals;
  readonly layout: InstanceLayout;
  readonly liveSourceParts: Map<PartId, Part>;
  readonly sourceParts: PartRevisionMap<PartId, Part>;
  readonly attachedParts: PartRevisionMap<PartId, Part>;
  readonly draw: DrawResources;
  readonly writes: readonly StagedBufferWrite[];
  readonly complete: () => void;
  readonly completed: () => boolean;
};

function preparedUpdate(options: PreparedOptions): PreparedAttachmentOccurrenceUpdate {
  return {
    draw: options.draw,
    layout: options.layout,
    parts: options.attachedParts,
    sourceParts: options.sourceParts,
    interaction: options.interaction,
    results: options.results,
    commit: () => {
      commitPrepared(options);
    },
    discard: () => {
      if (options.completed()) return;
      discardStagedOccurrenceResources(
        options.draw,
        options.bundle.draw,
        options.delta.affectedPartIds,
      );
      options.complete();
    },
  };
}

function commitPrepared(options: PreparedOptions): void {
  if (options.completed()) throw new Error("Occurrence revision is no longer pending");
  const liveLayout = options.attachment.layout;
  if (liveLayout === undefined) throw new Error("Occurrence revision layout is unavailable");
  const partIds = options.delta.affectedPartIds;
  for (const partId of partIds) commitStagedStorage(options.bundle.draw, options.draw, partId);
  commitStagedPartResults(options.bundle.draw, options.draw, partIds);
  commitStagedWrites(options.bundle.draw, options, partIds);
  commitDrawOverlays(options.bundle.draw, options.draw);
  commitLayout(liveLayout, options.layout, options.slotLocals);
  options.flags.commit(options.attachment.styleFlags());
  options.instances.commit(options.attachment.instances);
  options.slotByInstanceId.commit(options.attachment.slotByInstanceId);
  options.attachedParts.commit(options.attachment.attachedParts);
  options.sourceParts.commit(options.liveSourceParts);
  Object.assign(options.attachment, options.calls);
  options.attachment.interactionBeforeLastInstanceUpdate = options.attachment.interactionState;
  options.attachment.interactionState = options.interaction;
  releasePartDefinitions({
    runtime: options.runtime,
    layout: liveLayout,
    attachedParts: options.attachment.attachedParts,
    sourceParts: options.liveSourceParts,
    partIds: options.delta.removedPartIds,
    draw: options.bundle.draw,
  });
  options.bundle.draw.cost.merge(options.draw.cost);
  options.bundle.draw.cost.completeTransaction();
  options.complete();
}

function stageAddedParts(
  parts: ReadonlyMap<PartId, Part>,
  partIds: ReadonlySet<PartId>,
  source: PartRevisionMap<PartId, Part>,
  attached: PartRevisionMap<PartId, Part>,
): void {
  for (const partId of partIds) {
    const part = parts.get(partId);
    if (part === undefined) throw new Error(`Added part ${partId} is not registered`);
    source.set(partId, part);
    attached.set(partId, part);
  }
}

function stageResults(
  draw: DrawResources,
  results: PartRevisionResultState | undefined,
  runtime: PackedSceneRuntime,
  layout: InstanceLayout,
  partIds: ReadonlySet<PartId>,
): void {
  const staged = results?.staged;
  if (staged === undefined) return;
  if (staged.glyphs !== undefined)
    syncOrientationGlyphs(draw.orientationGlyphs, staged.glyphs, runtime, layout);
  if (staged.deformation !== undefined)
    syncDeformations(draw, staged.deformation, runtime, layout, partIds);
  if (staged.colors !== undefined) syncResultColors(draw, staged.colors, runtime, layout, partIds);
}

function stageOccurrenceLayout(
  source: InstanceLayout,
  slotPartLocal: Int32Array,
  partIds: ReadonlySet<PartId>,
): InstanceLayout {
  const partLocalSlots = new PartRevisionMap(source.partLocalSlots);
  for (const partId of partIds) {
    const slots = source.partLocalSlots.get(partId);
    if (slots !== undefined) partLocalSlots.set(partId, slots.slice());
  }
  return {
    ...source,
    slotPartLocal,
    partSlots: new PartRevisionMap(source.partSlots),
    partLocalSlots,
    partOrder: source.partOrder.slice(),
    partVisibleCounts: new PartRevisionMap(source.partVisibleCounts),
    partEdgeCounts: new PartRevisionMap(source.partEdgeCounts),
    partNodeCounts: new PartRevisionMap(source.partNodeCounts),
    partTransparentCounts: new PartRevisionMap(source.partTransparentCounts),
    partSelectionCounts: new PartRevisionMap(source.partSelectionCounts),
    partSelectedNodeCounts: new PartRevisionMap(source.partSelectedNodeCounts),
    partSelectedNodeDrawCalls: new PartRevisionMap(source.partSelectedNodeDrawCalls),
    partSelectionDrawCalls: new PartRevisionMap(source.partSelectionDrawCalls),
    partSurfaceDrawCalls: new PartRevisionMap(source.partSurfaceDrawCalls),
  };
}

function stageSlotLocals(source: Int32Array): StagedSlotLocals {
  const changes = new Map<number, number>();
  const values = new Proxy(source, {
    get(target, key) {
      if (key === "length") return target.length;
      const index = arrayIndex(key);
      if (index !== undefined) return changes.get(index) ?? target[index];
      return Reflect.get(target, key, target) as unknown;
    },
    set(target, key, value) {
      const index = arrayIndex(key);
      if (index === undefined) return Reflect.set(target, key, value, target);
      changes.set(index, Number(value));
      return true;
    },
  });
  return {
    values,
    commit(target) {
      for (const [index, value] of changes) target.slotPartLocal[index] = value;
    },
  };
}

function commitLayout(live: InstanceLayout, staged: InstanceLayout, slots: StagedSlotLocals): void {
  if (staged.slotPartLocal !== slots.values) live.slotPartLocal = staged.slotPartLocal;
  else slots.commit(live);
  live.instanceCount = staged.instanceCount;
  live.visibleCount = staged.visibleCount;
  live.partOrder.splice(0, live.partOrder.length, ...staged.partOrder);
  commitOverlay(live.partSlots, staged.partSlots);
  commitOverlay(live.partLocalSlots, staged.partLocalSlots);
  commitOverlay(live.partVisibleCounts, staged.partVisibleCounts);
  commitOverlay(live.partEdgeCounts, staged.partEdgeCounts);
  commitOverlay(live.partNodeCounts, staged.partNodeCounts);
  commitOverlay(live.partTransparentCounts, staged.partTransparentCounts);
  commitOverlay(live.partSelectionCounts, staged.partSelectionCounts);
  commitOverlay(live.partSelectedNodeCounts, staged.partSelectedNodeCounts);
  commitOverlay(live.partSelectedNodeDrawCalls, staged.partSelectedNodeDrawCalls);
  commitOverlay(live.partSelectionDrawCalls, staged.partSelectionDrawCalls);
  commitOverlay(live.partSurfaceDrawCalls, staged.partSurfaceDrawCalls);
}

function commitDrawOverlays(live: DrawResources, staged: DrawResources): void {
  commitOverlay(live.parts, staged.parts);
  commitOverlay(live.primitiveParts, staged.primitiveParts);
  commitOverlay(live.nodeParts, staged.nodeParts);
  commitOverlay(live.visibilitySkins, staged.visibilitySkins);
  commitOverlay(live.admissionCache, staged.admissionCache);
}

function commitOverlay<K, V>(target: Map<K, V>, source: Map<K, V>): void {
  if (source instanceof PartRevisionMap) source.commit(target);
}

function arrayIndex(key: PropertyKey): number | undefined {
  if (typeof key !== "string" || !/^(?:0|[1-9]\d*)$/.test(key)) return undefined;
  const index = Number(key);
  return Number.isSafeInteger(index) ? index : undefined;
}
