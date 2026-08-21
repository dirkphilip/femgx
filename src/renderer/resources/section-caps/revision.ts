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
} from "../draw-resources";
import {
  appendRevisedSectionCapParts,
  reconcileRevisedSectionCapColors,
  removeSectionCaps,
  reviseSectionCapColors,
  reviseSectionCapParts,
} from "./section-cap-frame-overlay";

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
