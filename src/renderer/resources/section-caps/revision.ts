import type { PartId } from "../../../geometry/part";
import type { InteractionState } from "../../../interaction/interaction";
import type { PackedSceneRuntime } from "../../../scene-runtime/runtime";
import type { SectionPlane } from "../../../math/section-plane";
import { stagedPartRevisionKeys } from "../../attachment/part-revision-overlay";
import { buildSectionCapFrame, type SectionCapFrame } from "../../section-caps";
import {
  destroyInstancePartResources,
  destroyPartResources,
  type DrawResources,
  uploadGeometryPart,
} from "../draw-resources";
import { removeSectionCaps } from "./section-cap-frame";
import type { RuntimeOccurrenceDelta } from "../../../scene-runtime/occurrence-update";

export interface PreparedSectionCapRevision {
  readonly frame: SectionCapFrame | undefined;
  readonly retained: SectionCapFrame | undefined;
  readonly oldCapIds: ReadonlySet<PartId>;
  readonly newCapIds: ReadonlySet<PartId>;
  readonly runtime: PackedSceneRuntime;
  readonly interaction: InteractionState;
  readonly dirty: boolean;
  readonly counters: SectionCapRevisionCounters;
}

/** Exact structural work performed while preparing cap fragments. */
export interface SectionCapRevisionCounters {
  readonly slotLookups: number;
  readonly capIdsVisited: number;
  readonly resourceLookups: number;
}

const NO_REVISION_WORK: SectionCapRevisionCounters = {
  slotLookups: 0,
  capIdsVisited: 0,
  resourceLookups: 0,
};

interface RevisionOwnerState {
  readonly frame: SectionCapFrame | undefined;
  readonly retained: SectionCapFrame | undefined;
  readonly runtime: PackedSceneRuntime | undefined;
  readonly dirty: boolean;
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
  if (
    options.plane === undefined ||
    owner.frame === undefined ||
    owner.retained === undefined ||
    owner.runtime !== options.runtime ||
    owner.dirty
  ) {
    return dirtyRevision(owner, options, oldCapIds);
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
    runtime: options.runtime,
    interaction: options.interaction,
    dirty: false,
    counters: NO_REVISION_WORK,
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
  const oldLookup = capIdsForSlots(owner.retained, slots);
  const oldCapIds = oldLookup.ids;
  if (
    options.plane === undefined ||
    owner.frame === undefined ||
    owner.retained === undefined ||
    owner.dirty
  ) {
    return exactDirtyOccurrence(owner, options, oldCapIds, oldLookup);
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
    const newLookup = capIdsForSlots(frame, slots);
    const resourceLookups = uploadCapGeometry(options.draw, frame, newLookup.ids);
    return occurrenceRevisionResult(options, frame, {
      oldLookup,
      newLookup,
      resourceLookups,
    });
  } catch (error) {
    discardNewCapResources(options.draw, owner.retained, options.delta.affectedPartIds);
    throw error;
  }
}

function occurrenceRevisionResult(
  options: Omit<SectionCapRevisionOptions, "partIds"> & { readonly delta: RuntimeOccurrenceDelta },
  frame: SectionCapFrame,
  work: OccurrenceCapWork,
): PreparedSectionCapRevision {
  return {
    frame,
    retained: frame,
    oldCapIds: work.oldLookup.ids,
    newCapIds: work.newLookup.ids,
    runtime: options.runtime,
    interaction: options.interaction,
    dirty: false,
    counters: {
      slotLookups: work.oldLookup.slotLookups + work.newLookup.slotLookups,
      capIdsVisited: work.oldLookup.idsVisited + work.newLookup.idsVisited,
      resourceLookups: work.resourceLookups,
    },
  };
}

function exactDirtyOccurrence(
  owner: RevisionOwnerState,
  options: Omit<SectionCapRevisionOptions, "partIds"> & { readonly delta: RuntimeOccurrenceDelta },
  oldCapIds: ReadonlySet<PartId>,
  lookup: CapSlotLookup,
): PreparedSectionCapRevision {
  const frame = owner.frame === undefined ? undefined : removeSectionCaps(owner.frame, oldCapIds);
  const retained =
    owner.retained === undefined ? undefined : removeSectionCaps(owner.retained, oldCapIds);
  return {
    frame,
    retained,
    oldCapIds,
    newCapIds: new Set(),
    runtime: options.runtime,
    interaction: options.interaction,
    dirty: true,
    counters: {
      slotLookups: lookup.slotLookups,
      capIdsVisited: lookup.idsVisited,
      resourceLookups: 0,
    },
  };
}

function capIdsForSlots(
  frame: SectionCapFrame | undefined,
  slots: ReadonlySet<number>,
): CapSlotLookup {
  const ids = new Set<PartId>();
  if (frame === undefined) return { ids, slotLookups: slots.size, idsVisited: 0 };
  let idsVisited = 0;
  for (const slot of slots) {
    for (const capId of frame.capIdsBySourceSlot.get(slot) ?? []) {
      ids.add(capId);
      idsVisited += 1;
    }
  }
  return { ids, slotLookups: slots.size, idsVisited };
}

interface CapSlotLookup {
  readonly ids: Set<PartId>;
  readonly slotLookups: number;
  readonly idsVisited: number;
}

interface OccurrenceCapWork {
  readonly oldLookup: CapSlotLookup;
  readonly newLookup: CapSlotLookup;
  readonly resourceLookups: number;
}

function uploadCapGeometry(
  draw: DrawResources,
  frame: SectionCapFrame,
  capIds: ReadonlySet<PartId>,
): number {
  let lookups = 0;
  for (const capId of capIds) {
    lookups += 1;
    const cap = frame.parts.get(capId);
    if (cap === undefined) continue;
    for (const geometry of cap.geometries) uploadGeometryPart(draw, cap, geometry);
  }
  return lookups;
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
): PreparedSectionCapRevision {
  const frame = owner.frame === undefined ? undefined : removeSectionCaps(owner.frame, oldCapIds);
  const retained =
    owner.retained === undefined ? undefined : removeSectionCaps(owner.retained, oldCapIds);
  return {
    frame,
    retained,
    oldCapIds,
    newCapIds: new Set(),
    runtime: options.runtime,
    interaction: options.interaction,
    dirty: true,
    counters: NO_REVISION_WORK,
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
  transferMapEntry(live.resultColors, staged.resultColors, capId);
}

function transferMapEntry<T>(target: Map<PartId, T>, source: ReadonlyMap<PartId, T>, id: PartId) {
  const value = source.get(id);
  if (value === undefined) target.delete(id);
  else target.set(id, value);
}
