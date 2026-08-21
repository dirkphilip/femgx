import type { ViewportSlotId } from "../viewport/view";
import type { WorkbenchViewportSlot } from "../viewport/viewport-slots";
import type {
  AssemblyId,
  AssemblyOccurrenceId,
  PartId,
  PartOccurrenceId,
  SceneUpdateOutcome,
  Viewport,
} from "@/entries/root";
import { errorMessage, type WorkbenchModel } from "../models/model";
import type { WorkbenchModelCatalog } from "../models/model-catalog";
import { parseLivePartRequest, prepareLivePartEdit } from "../live-part-addition";
import { BASE_RESULT_VALUE } from "../results/result-controls";
import type { WorkbenchLivePartDialogSnapshot } from "../results/snapshot";
import { rememberCatalogModel } from "./controller-catalog";

interface LivePartEditOwner {
  model: WorkbenchModel;
  livePartDialog: WorkbenchLivePartDialogSnapshot | undefined;
  readonly viewport: { readonly scene: WorkbenchModel["scene"] };
  readonly viewportSlots: { all(): readonly WorkbenchViewportSlot[] };
  readonly presentation: { setFeedback(message: string, kind?: "info" | "error"): void };
  readonly showState: (slotId: ViewportSlotId) => {
    resultMode: "base" | "colored" | "deformed";
    scalarFieldId: string;
    resultPlaybackActive: boolean;
    resultPlaybackPlaying: boolean;
  };
  applyState(slotId: ViewportSlotId): void;
  readonly visibilityPanel: { rebuild(): void };
  readonly runtime: { readonly partOccurrenceCount: number };
  render(): void;
  publishSnapshot(): void;
  readonly catalog: WorkbenchModelCatalog;
  models: readonly WorkbenchModel[];
}

interface VisibilitySnapshot {
  readonly parts: ReadonlyMap<PartId, boolean>;
  readonly assemblies: ReadonlyMap<AssemblyId, boolean>;
  readonly partOccurrences: readonly {
    readonly id: PartOccurrenceId;
    readonly overrideVisible: boolean;
  }[];
  readonly assemblyOccurrences: readonly {
    readonly id: AssemblyOccurrenceId;
    readonly assemblyId: AssemblyId;
    readonly parentId: AssemblyOccurrenceId | undefined;
    readonly effectiveVisible: boolean;
  }[];
}

/** Opens the focused dialog without creating a second demo state owner. */
export function openLivePartDialogForOwner(
  owner: LivePartEditOwner,
  kind: "add" | "instance",
  partId?: number,
): void {
  if (kind === "instance" && (partId === undefined || !owner.model.scene.parts.has(partId))) return;
  const partName = partId === undefined ? undefined : owner.model.partNames.get(partId);
  owner.livePartDialog = {
    kind,
    ...(partId === undefined ? {} : { partId }),
    ...(partName === undefined ? {} : { partName }),
  };
  owner.publishSnapshot();
}

/** Closes a pending live-edit dialog. */
export function cancelLivePartEditForOwner(owner: LivePartEditOwner): void {
  if (owner.livePartDialog === undefined) return;
  owner.livePartDialog = undefined;
  owner.publishSnapshot();
}

/** Applies one prebuilt canonical scene edit to every open viewport slot. */
export function applyLivePartEditForOwner(
  owner: LivePartEditOwner,
  copies: string,
  spacing: string,
): void {
  const dialog = owner.livePartDialog;
  if (dialog === undefined) return;
  const request = parseLivePartRequest(dialog.kind, dialog.partId, copies, spacing);
  if (request === undefined) {
    owner.presentation.setFeedback(
      "Copies must be an integer from 1 to 100,000 and spacing must be positive.",
      "error",
    );
    return;
  }
  const before = owner.model;
  const edit = prepareLivePartEdit(before, request);
  const slots = owner.viewportSlots.all();
  const committed: WorkbenchViewportSlot[] = [];
  const visibilityBefore = new Map<WorkbenchViewportSlot, VisibilitySnapshot>();
  const outcomes: SceneUpdateOutcome[] = [];
  const start = performance.now();
  try {
    for (const slot of slots) {
      visibilityBefore.set(slot, captureVisibility(slot.viewport));
      outcomes.push(slot.viewport.updateScene(edit.apply));
      committed.push(slot);
    }
  } catch (error) {
    restoreCommittedSlots(owner, committed, before.scene, visibilityBefore);
    owner.presentation.setFeedback(
      `Live edit could not be applied: ${errorMessage(error)}`,
      "error",
    );
    return;
  }
  owner.model = rememberCatalogModel(owner, edit.modelAfter(owner.viewport.scene));
  owner.livePartDialog = undefined;
  for (const slot of slots) {
    const state = owner.showState(slot.id);
    if (slot.viewport.results.state === undefined && state.resultMode !== "base") {
      state.resultMode = "base";
      state.scalarFieldId = BASE_RESULT_VALUE;
      state.resultPlaybackActive = false;
      state.resultPlaybackPlaying = false;
    }
    owner.applyState(slot.id);
  }
  owner.visibilityPanel.rebuild();
  const duration = Math.round(performance.now() - start);
  owner.presentation.setFeedback(
    `${request.kind === "add" ? "Added" : "Instanced"} ${request.copies.toLocaleString()} placement${request.copies === 1 ? "" : "s"} of Part ${edit.partId} in ${duration} ms · ${owner.runtime.partOccurrenceCount} occurrences total.${resultsClearedFeedback(outcomes)}`,
  );
  owner.render();
}

function restoreCommittedSlots(
  owner: LivePartEditOwner,
  committed: readonly WorkbenchViewportSlot[],
  scene: WorkbenchModel["scene"],
  visibilityBefore: ReadonlyMap<WorkbenchViewportSlot, VisibilitySnapshot>,
): void {
  for (const slot of committed) {
    slot.viewport.replaceScene(scene);
    const visibility = visibilityBefore.get(slot);
    if (visibility !== undefined) restoreVisibility(slot.viewport, visibility);
  }
  for (const slot of committed) {
    owner.applyState(slot.id);
    slot.viewport.render();
  }
  owner.visibilityPanel.rebuild();
}

function captureVisibility(viewport: Viewport): VisibilitySnapshot {
  const parts = new Map<PartId, boolean>(
    [...viewport.scene.parts.keys()].map((partId) => [
      partId,
      viewport.scene.visiblePartIds.has(partId),
    ]),
  );
  const assemblies = new Map<AssemblyId, boolean>(
    [...viewport.scene.assemblies.keys()].map((assemblyId) => [
      assemblyId,
      viewport.scene.visibleAssemblyIds.has(assemblyId),
    ]),
  );
  const currentPartOccurrences = [...viewport.occurrences.partOccurrences()];
  const partOccurrences = currentPartOccurrences.map((occurrence) => ({
    id: occurrence.partOccurrenceId,
    overrideVisible: occurrence.overrideVisible,
  }));
  const currentAssemblyOccurrences = [...viewport.occurrences.assemblyOccurrences()];
  const assemblyOccurrences = currentAssemblyOccurrences.map((occurrence) => ({
    id: occurrence.assemblyOccurrenceId,
    assemblyId: occurrence.assemblyId,
    parentId: occurrence.parentAssemblyOccurrenceId,
    effectiveVisible: occurrence.effectiveVisible,
  }));
  for (const occurrence of currentPartOccurrences) {
    parts.set(occurrence.partId, occurrence.partVisible);
  }
  for (const occurrence of currentAssemblyOccurrences) {
    assemblies.set(occurrence.assemblyId, occurrence.visible);
  }
  return { parts, assemblies, partOccurrences, assemblyOccurrences };
}

function restoreVisibility(viewport: Viewport, snapshot: VisibilitySnapshot): void {
  for (const [partId, visible] of snapshot.parts)
    viewport.visibility.setPartVisible(partId, visible);
  for (const [assemblyId, visible] of snapshot.assemblies)
    viewport.visibility.setAssemblyVisible(assemblyId, visible);

  const assemblies = new Map(
    snapshot.assemblyOccurrences.map((occurrence) => [occurrence.id, occurrence]),
  );
  const ordered = [...snapshot.assemblyOccurrences].sort(
    (left, right) => occurrenceDepth(left, assemblies) - occurrenceDepth(right, assemblies),
  );
  for (const occurrence of ordered) {
    const parent =
      occurrence.parentId === undefined ? undefined : assemblies.get(occurrence.parentId);
    const definitionVisible = snapshot.assemblies.get(occurrence.assemblyId) ?? true;
    const overrideVisible =
      (parent?.effectiveVisible ?? true) && definitionVisible ? occurrence.effectiveVisible : true;
    viewport.visibility.setAssemblyOccurrenceVisible(occurrence.id, overrideVisible);
  }
  for (const occurrence of snapshot.partOccurrences)
    viewport.visibility.setPartOccurrenceVisible(occurrence.id, occurrence.overrideVisible);
}

function occurrenceDepth(
  occurrence: VisibilitySnapshot["assemblyOccurrences"][number],
  assemblies: ReadonlyMap<AssemblyOccurrenceId, VisibilitySnapshot["assemblyOccurrences"][number]>,
): number {
  let depth = 0;
  let parentId = occurrence.parentId;
  while (parentId !== undefined) {
    depth += 1;
    parentId = assemblies.get(parentId)?.parentId;
  }
  return depth;
}

function resultsClearedFeedback(outcomes: readonly SceneUpdateOutcome[]): string {
  const cleared = outcomes.find((outcome) => outcome.results === "cleared");
  return cleared === undefined ? "" : ` Results cleared: ${cleared.reason}.`;
}
