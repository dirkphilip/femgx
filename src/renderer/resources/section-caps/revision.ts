import type { Part, PartId } from "../../../geometry/part";
import type { InteractionState } from "../../../interaction/interaction";
import type { PackedSceneRuntime } from "../../../scene-runtime/runtime";
import type { ResultColorMap } from "../../../results/colors";
import type { SectionPlane } from "../../../math/section-plane";
import { stagedPartRevisionKeys } from "../../attachment/part-revision-overlay";
import { buildSectionCapFrame, type SectionCapFrame } from "../../section-caps";
import {
  destroyInstancePartResources,
  destroyPartResources,
  type DrawResources,
  uploadGeometryPart,
} from "../draw-resources";
import {
  appendRevisedSectionCapParts,
  reconcileRevisedSectionCapColors,
  removeSectionCaps,
  reviseSectionCapColors,
  reviseSectionCapParts,
} from "./section-cap-frame-overlay";
import type { RuntimeOccurrenceDelta } from "../../../scene-runtime/occurrence-update";
import { PartRevisionMap } from "../../attachment/part-revision-overlay";

export interface PreparedSectionCapRevision {
  readonly frame: SectionCapFrame | undefined;
  readonly retained: SectionCapFrame | undefined;
  readonly oldCapIds: ReadonlySet<PartId>;
  readonly newCapIds: ReadonlySet<PartId>;
  readonly renderedParts: ReadonlyMap<PartId, Part>;
  readonly renderedColors: ResultColorMap | undefined;
  readonly sourceColors: ResultColorMap | undefined;
  readonly runtime: PackedSceneRuntime;
  readonly interaction: InteractionState;
  readonly dirty: boolean;
}

interface RevisionOwnerState {
  readonly frame: SectionCapFrame | undefined;
  readonly retained: SectionCapFrame | undefined;
  readonly runtime: PackedSceneRuntime | undefined;
  readonly dirty: boolean;
  readonly renderedParts: ReadonlyMap<PartId, Part>;
  readonly renderedColors: ResultColorMap | undefined;
}

type SectionCapRevisionOptions = Omit<Parameters<typeof buildSectionCapFrame>[0], "plane"> & {
  readonly plane: SectionPlane | undefined;
  readonly partIds: ReadonlySet<PartId>;
};

/** Builds exact replacement cap fragments into a detached draw overlay. */
export function prepareSectionCapRevision(
  owner: RevisionOwnerState,
  options: SectionCapRevisionOptions,
): PreparedSectionCapRevision {
  const oldCapIds = capIdsFor(owner.retained, options.partIds);
  const revisedParts = reviseSectionCapParts(
    owner.renderedParts,
    options.parts,
    options.partIds,
    oldCapIds,
  );
  if (
    options.plane === undefined ||
    owner.frame === undefined ||
    owner.retained === undefined ||
    owner.runtime !== options.runtime ||
    owner.dirty
  ) {
    return dirtyRevision(owner, options, oldCapIds, revisedParts);
  }
  const plane = options.plane;
  const retained = removeSectionCaps(owner.retained, oldCapIds);
  let frame: SectionCapFrame;
  try {
    frame = buildSectionCapFrame({
      ...options,
      plane,
      reusable: retained,
      revisedPartIds: options.partIds,
    });
    uploadRevisedCapGeometry(options.draw, frame, options.partIds);
  } catch (error) {
    discardNewCapResources(options.draw, owner.retained, options.partIds);
    throw error;
  }
  const newCapIds = capIdsFor(frame, options.partIds);
  return {
    frame,
    retained: frame,
    oldCapIds,
    newCapIds,
    renderedParts: appendRevisedSectionCapParts(revisedParts, frame, options.partIds),
    renderedColors: reconcileRevisedSectionCapColors(
      reviseSectionCapColors(owner.renderedColors, options.partIds, oldCapIds),
      options.resultColors,
      frame,
      options.partIds,
    ),
    sourceColors: options.resultColors,
    runtime: options.runtime,
    interaction: options.interaction,
    dirty: false,
  };
}

/** Builds only cap fragments owned by placement slots changed in one transaction. */
export function prepareSectionCapOccurrenceRevision(
  owner: RevisionOwnerState,
  options: Omit<SectionCapRevisionOptions, "partIds"> & {
    readonly delta: RuntimeOccurrenceDelta;
  },
): PreparedSectionCapRevision {
  const slots = new Set(options.delta.slots.map(({ slot }) => slot));
  const oldCapIds = capIdsForSlots(owner.retained, slots);
  if (
    options.plane === undefined ||
    owner.frame === undefined ||
    owner.retained === undefined ||
    owner.dirty
  ) {
    return exactDirtyOccurrence(owner, options, oldCapIds);
  }
  const retained = removeSectionCaps(owner.retained, oldCapIds);
  let frame: SectionCapFrame;
  try {
    frame = buildSectionCapFrame({
      ...options,
      plane: options.plane,
      reusable: retained,
      revisedPartIds: options.delta.affectedPartIds,
      revisedSlots: slots,
    });
    uploadRevisedCapGeometry(options.draw, frame, options.delta.affectedPartIds);
  } catch (error) {
    discardNewCapResources(options.draw, owner.retained, options.delta.affectedPartIds);
    throw error;
  }
  const newCapIds = capIdsForSlots(frame, slots);
  return {
    frame,
    retained: frame,
    oldCapIds,
    newCapIds,
    renderedParts: exactRenderedParts(owner.renderedParts, options.parts, frame, {
      sourceIds: options.delta.affectedPartIds,
      removed: oldCapIds,
      added: newCapIds,
    }),
    renderedColors: exactRenderedColors(owner.renderedColors, options.resultColors, frame, {
      sourceIds: options.delta.affectedPartIds,
      removed: oldCapIds,
      added: newCapIds,
    }),
    sourceColors: options.resultColors,
    runtime: options.runtime,
    interaction: options.interaction,
    dirty: false,
  };
}

function exactDirtyOccurrence(
  owner: RevisionOwnerState,
  options: Omit<SectionCapRevisionOptions, "partIds"> & { readonly delta: RuntimeOccurrenceDelta },
  oldCapIds: ReadonlySet<PartId>,
): PreparedSectionCapRevision {
  const frame = owner.frame === undefined ? undefined : removeSectionCaps(owner.frame, oldCapIds);
  const retained =
    owner.retained === undefined ? undefined : removeSectionCaps(owner.retained, oldCapIds);
  return {
    frame,
    retained,
    oldCapIds,
    newCapIds: new Set(),
    renderedParts: exactRenderedParts(owner.renderedParts, options.parts, undefined, {
      sourceIds: options.delta.affectedPartIds,
      removed: oldCapIds,
      added: new Set(),
    }),
    renderedColors: exactRenderedColors(owner.renderedColors, options.resultColors, undefined, {
      sourceIds: options.delta.affectedPartIds,
      removed: oldCapIds,
      added: new Set(),
    }),
    sourceColors: options.resultColors,
    runtime: options.runtime,
    interaction: options.interaction,
    dirty: true,
  };
}

function capIdsForSlots(
  frame: SectionCapFrame | undefined,
  slots: ReadonlySet<number>,
): Set<PartId> {
  const ids = new Set<PartId>();
  if (frame === undefined) return ids;
  for (const [capId, slot] of frame.sourceSlots) if (slots.has(slot)) ids.add(capId);
  return ids;
}

function exactRenderedParts(
  current: ReadonlyMap<PartId, Part>,
  source: ReadonlyMap<PartId, Part>,
  frame: SectionCapFrame | undefined,
  changes: ExactCapChanges,
): ReadonlyMap<PartId, Part> {
  const next = new PartRevisionMap(current);
  for (const id of changes.removed) next.delete(id);
  for (const id of changes.sourceIds) {
    const part = source.get(id);
    if (part === undefined) next.delete(id);
    else if (current.get(id) !== part) next.set(id, part);
  }
  for (const id of changes.added) {
    const part = frame?.parts.get(id);
    if (part !== undefined) next.set(id, part);
  }
  return next;
}

function exactRenderedColors(
  current: ResultColorMap | undefined,
  source: ResultColorMap | undefined,
  frame: SectionCapFrame | undefined,
  changes: ExactCapChanges,
): ResultColorMap | undefined {
  if (current === undefined && source === undefined && changes.added.size === 0) return undefined;
  const next = new PartRevisionMap(current ?? new Map());
  for (const id of changes.removed) next.delete(id);
  for (const id of changes.sourceIds) {
    const colors = source?.get(id);
    if (colors === undefined) next.delete(id);
    else next.set(id, colors);
  }
  for (const id of changes.added) {
    const colors = frame?.resultColors.get(id);
    if (colors !== undefined) next.set(id, colors);
  }
  return next;
}

interface ExactCapChanges {
  readonly sourceIds: ReadonlySet<PartId>;
  readonly removed: ReadonlySet<PartId>;
  readonly added: ReadonlySet<PartId>;
}

function uploadRevisedCapGeometry(
  draw: DrawResources,
  frame: SectionCapFrame,
  partIds: ReadonlySet<PartId>,
): void {
  for (const sourcePartId of partIds) {
    for (const capId of frame.sourceCapIds.get(sourcePartId) ?? []) {
      const cap = frame.parts.get(capId);
      if (cap === undefined) continue;
      for (const geometry of cap.geometries) uploadGeometryPart(draw, cap, geometry);
    }
  }
}

function dirtyRevision(
  owner: RevisionOwnerState,
  options: SectionCapRevisionOptions,
  oldCapIds: ReadonlySet<PartId>,
  renderedParts: ReadonlyMap<PartId, Part>,
): PreparedSectionCapRevision {
  const frame = owner.frame === undefined ? undefined : removeSectionCaps(owner.frame, oldCapIds);
  const retained =
    owner.retained === undefined ? undefined : removeSectionCaps(owner.retained, oldCapIds);
  return {
    frame,
    retained,
    oldCapIds,
    newCapIds: new Set(),
    renderedParts,
    renderedColors: reviseSectionCapColors(owner.renderedColors, options.partIds, oldCapIds),
    sourceColors: options.resultColors,
    runtime: options.runtime,
    interaction: options.interaction,
    dirty: true,
  };
}

/** Transfers staged caps and retires replaced live caps. */
export function commitSectionCapResources(
  prepared: PreparedSectionCapRevision,
  staged: DrawResources,
  live: DrawResources,
): void {
  for (const capId of prepared.oldCapIds) {
    destroyPartResources(live, capId);
    destroyInstancePartResources(live, capId);
  }
  for (const capId of prepared.newCapIds) transferCapResources(live, staged, capId);
}

/** Destroys all resources owned by an uncommitted cap revision. */
export function discardSectionCapRevision(
  prepared: PreparedSectionCapRevision,
  staged: DrawResources,
): void {
  for (const capId of prepared.newCapIds) {
    destroyPartResources(staged, capId);
    destroyInstancePartResources(staged, capId);
  }
}

function capIdsFor(frame: SectionCapFrame | undefined, partIds: ReadonlySet<PartId>): Set<PartId> {
  const capIds = new Set<PartId>();
  for (const partId of partIds) {
    for (const capId of frame?.sourceCapIds.get(partId) ?? []) capIds.add(capId);
  }
  return capIds;
}

function discardNewCapResources(
  draw: DrawResources,
  retained: SectionCapFrame,
  partIds: ReadonlySet<PartId>,
): void {
  for (const id of stagedPartRevisionKeys(draw.storages)) {
    if (partIds.has(id) || retained.parts.has(id)) continue;
    destroyPartResources(draw, id);
    destroyInstancePartResources(draw, id);
  }
}

function transferCapResources(live: DrawResources, staged: DrawResources, capId: PartId): void {
  transferMapEntry(live.parts, staged.parts, capId);
  transferMapEntry(live.primitiveParts, staged.primitiveParts, capId);
  transferMapEntry(live.nodeParts, staged.nodeParts, capId);
  transferMapEntry(live.storages, staged.storages, capId);
  transferMapEntry(live.visibilitySkins, staged.visibilitySkins, capId);
  transferMapEntry(live.admissionCache, staged.admissionCache, capId);
}

function transferMapEntry<T>(target: Map<PartId, T>, source: ReadonlyMap<PartId, T>, id: PartId) {
  const value = source.get(id);
  if (value === undefined) target.delete(id);
  else target.set(id, value);
}
