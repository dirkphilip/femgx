import { type Viewport, type PartOccurrenceId, type PartId, type Scene } from "@/entries/root";
import {
  isTargetHighlighted,
  setTargetHighlighted,
  type InteractionState,
} from "@/entries/interaction";
import { selectedElementVisibilitySummary } from "@/interaction/selection-queries";
import type { BodyId } from "@/entries/model";
import type { SceneOccurrences } from "@/entries/root";
import type { SelectTarget } from "../selection/pick";
import { elementTarget } from "../selection/pick";

/** Runtime hooks used by menu and visibility-panel visibility actions. */
export interface VisibilityActionOptions {
  readonly viewport: () => Viewport;
  readonly scene: () => Scene;
  readonly runtime: () => SceneOccurrences;
  readonly interaction: () => InteractionState;
  readonly setInteraction: (interaction: InteractionState) => void;
  readonly applyInteraction: (interaction: InteractionState) => void;
  readonly syncPanel: () => void;
  readonly render: () => void;
  readonly feedback?: (message: string) => void;
}

/** Keeps all demo visibility mutations on the viewport/runtime path. */
export class WorkbenchVisibilityActions {
  private readonly options: VisibilityActionOptions;

  constructor(options: VisibilityActionOptions) {
    this.options = options;
  }

  setPartVisible(partId: PartId, visible: boolean): void {
    this.options.viewport().visibility.setPartVisible(partId, visible);
    this.finish();
  }

  setPartOccurrenceVisible(partOccurrenceId: PartOccurrenceId, visible: boolean): void {
    this.options.viewport().visibility.setPartOccurrenceVisible(partOccurrenceId, visible);
    this.finish();
  }

  setAssemblyOccurrenceVisible(occurrenceId: string, visible: boolean): void {
    this.options.viewport().visibility.setAssemblyOccurrenceVisible(occurrenceId, visible);
    this.finish();
  }

  setBody(partOccurrenceId: PartOccurrenceId, bodyId: BodyId, visible: boolean): void {
    const ref = { partOccurrenceId, bodyId };
    this.options.viewport().visibility.setBodyVisible(ref, visible);
    this.finish();
  }

  setElement(partOccurrenceId: PartOccurrenceId, elementId: number, visible: boolean): void {
    const ref = { partOccurrenceId, elementId };
    this.options.viewport().visibility.setElementVisible(ref, visible);
    this.finish();
  }

  toggleElement(target: SelectTarget): void {
    const element = elementTarget(target);
    if (element?.kind !== "element") return;
    this.setElement(
      element.partOccurrenceId,
      element.elementId,
      !this.options.viewport().visibility.isElementEffectivelyVisible(element),
    );
  }

  /** Hides selected element occurrences in one active-slot interaction update. */
  hideSelected(): void {
    const interaction = this.options.interaction();
    const { selectedCount, visibleCount } = selectedElementVisibilitySummary(interaction, (ref) =>
      this.options.viewport().visibility.isElementEffectivelyVisible(ref),
    );
    if (visibleCount === 0) {
      this.options.feedback?.(
        selectedCount === 0
          ? "No selected elements to hide."
          : "Selected elements are already hidden.",
      );
      return;
    }

    this.options.viewport().visibility.hideSelectedElements();
    this.finish();
    this.options.feedback?.(
      visibleCount === selectedCount
        ? `Hidden ${visibleCount} selected element${visibleCount === 1 ? "" : "s"}.`
        : `Hidden ${visibleCount} of ${selectedCount} selected elements.`,
    );
  }

  bodyHighlight(partOccurrenceId: PartOccurrenceId, bodyId: BodyId): void {
    const ref = { partOccurrenceId, bodyId };
    const state = this.options.interaction();
    const highlighted = isTargetHighlighted(state, { kind: "body", partOccurrenceId, bodyId });
    this.options.setInteraction(
      setTargetHighlighted(state, { kind: "body", ...ref }, !highlighted),
    );
    this.finish();
  }

  toggleInstance(target: SelectTarget): void {
    if (target.kind !== "partOccurrence") return;
    const runtime = this.options.runtime();
    if (runtime.getPartOccurrence(target.partOccurrenceId) === undefined) return;
    this.setPartOccurrenceVisible(
      target.partOccurrenceId,
      !runtime.isPartOccurrenceVisible(target.partOccurrenceId),
    );
  }

  togglePart(target: SelectTarget): void {
    const partId = target.kind === "part" ? target.partId : this.partForTarget(target);
    if (partId === undefined) return;
    this.setPartVisible(partId, !this.partVisible(partId));
  }

  /** Restores every current model-visibility bit without changing interaction emphasis. */
  showAll(): void {
    const viewport = this.options.viewport();
    viewport.visibility.showAll();
    this.finish();
  }

  partVisible(partId: PartId): boolean {
    const runtime = this.options.runtime();
    for (const partOccurrenceId of runtime.visiblePartOccurrenceIds()) {
      if (runtime.getPartId(partOccurrenceId) !== partId) continue;
      return runtime.getPartOccurrence(partOccurrenceId)?.partVisible ?? false;
    }
    return false;
  }

  bodyVisible(partOccurrenceId: PartOccurrenceId, bodyId: BodyId): boolean {
    return this.options
      .viewport()
      .visibility.isBodyEffectivelyVisible({ partOccurrenceId, bodyId });
  }

  bodyHighlighted(partOccurrenceId: PartOccurrenceId, bodyId: BodyId): boolean {
    return isTargetHighlighted(this.options.interaction(), {
      kind: "body",
      partOccurrenceId,
      bodyId,
    });
  }

  private partForTarget(target: SelectTarget): PartId | undefined {
    if (target.kind === "part") return target.partId;
    if (target.kind === "assembly" || target.kind === "assemblyOccurrence") return undefined;
    return this.options.runtime().getPartId(target.partOccurrenceId);
  }

  private finish(render = true): void {
    this.options.syncPanel();
    if (render) this.options.render();
  }
}
