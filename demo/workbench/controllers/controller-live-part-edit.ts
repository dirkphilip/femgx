import type { ViewportSlotId } from "../viewport/view";
import type { WorkbenchViewportSlot } from "../viewport/viewport-slots";
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
  const start = performance.now();
  try {
    for (const slot of slots) {
      slot.viewport.updateScene(edit.apply);
      committed.push(slot);
    }
  } catch (error) {
    for (const slot of committed) slot.viewport.replaceScene(before.scene);
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
    `${request.kind === "add" ? "Added" : "Instanced"} ${request.copies.toLocaleString()} placement${request.copies === 1 ? "" : "s"} of Part ${edit.partId} in ${duration} ms · ${owner.runtime.partOccurrenceCount} occurrences total.`,
  );
  owner.render();
}
