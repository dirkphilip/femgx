import {
  isBodyVisible,
  isElementVisible,
  isTargetHighlighted,
  selectedTargets,
  setElementVisible,
  setTargetHighlighted,
  setBodyVisible,
  type Viewport,
  type InteractionTarget,
  type PartOccurrenceId,
  type InteractionState,
  type PartId,
  type Scene,
} from "../../../src/entries/root";
import type { BodyId } from "../../../src/entries/model";
import type { SceneRuntime } from "../../../src/entries/runtime";
import type { SelectTarget } from "../selection/pick";
import { elementTarget } from "../selection/pick";

/** Runtime hooks used by menu and visibility-panel visibility actions. */
export interface VisibilityActionOptions {
  readonly viewport: () => Viewport;
  readonly scene: () => Scene;
  readonly runtime: () => SceneRuntime;
  readonly interaction: () => InteractionState;
  readonly setInteraction: (interaction: InteractionState) => void;
  readonly applyInteraction: (interaction: InteractionState) => void;
  readonly syncPanel: () => void;
  readonly render: () => void;
  readonly feedback?: (message: string) => void;
}

type SelectedElementTarget = Extract<InteractionTarget, { readonly kind: "element" }>;

/** Returns selected element occurrences without promoting other target kinds. */
export function selectedElementTargets(
  interaction: InteractionState,
): readonly SelectedElementTarget[] {
  const seen = new Set<string>();
  const elements: SelectedElementTarget[] = [];
  for (const target of selectedTargets(interaction)) {
    if (target.kind !== "element") continue;
    const key = `${target.partOccurrenceId}:${target.elementId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    elements.push(target);
  }
  return elements;
}

/** Returns selected, currently visible element occurrences without promoting other target kinds. */
export function visibleSelectedElementTargets(
  interaction: InteractionState,
): readonly SelectedElementTarget[] {
  return selectedElementTargets(interaction).filter((target) =>
    isElementVisible(interaction, target),
  );
}

/** Keeps all demo visibility mutations on the viewport/runtime path. */
export class WorkbenchVisibilityActions {
  private readonly options: VisibilityActionOptions;

  constructor(options: VisibilityActionOptions) {
    this.options = options;
  }

  setPart(partId: PartId, visible: boolean): void {
    this.options.viewport().visibility.setPart(partId, visible);
    this.finish();
  }

  setPartOccurrence(partOccurrenceId: PartOccurrenceId, visible: boolean): void {
    this.options.viewport().visibility.setPartOccurrence(partOccurrenceId, visible);
    this.finish();
  }

  setAssemblyOccurrence(occurrenceId: string, visible: boolean): void {
    this.options.viewport().visibility.setAssemblyOccurrence(occurrenceId, visible);
    this.finish();
  }

  setBody(partOccurrenceId: PartOccurrenceId, bodyId: BodyId, visible: boolean): void {
    const ref = { partOccurrenceId, bodyId };
    this.options.setInteraction(setBodyVisible(this.options.interaction(), ref, visible));
    this.finish();
  }

  setElement(partOccurrenceId: PartOccurrenceId, elementId: number, visible: boolean): void {
    const ref = { partOccurrenceId, elementId };
    this.options.setInteraction(setElementVisible(this.options.interaction(), ref, visible));
    this.finish();
  }

  toggleElement(target: SelectTarget): void {
    const element = elementTarget(target);
    if (element?.kind !== "element") return;
    this.setElement(
      element.partOccurrenceId,
      element.elementId,
      !isElementVisible(this.options.interaction(), element),
    );
  }

  /** Hides selected element occurrences in one active-slot interaction update. */
  hideSelected(): void {
    const interaction = this.options.interaction();
    const selected = selectedElementTargets(interaction);
    const visible = visibleSelectedElementTargets(interaction);
    if (visible.length === 0) {
      this.options.feedback?.(
        selected.length === 0
          ? "No selected elements to hide."
          : "Selected elements are already hidden.",
      );
      return;
    }

    let next = interaction;
    for (const target of visible) {
      next = setElementVisible(next, target, false);
    }
    this.options.applyInteraction(next);
    this.finish();
    this.options.feedback?.(
      visible.length === selected.length
        ? `Hidden ${visible.length} selected element${visible.length === 1 ? "" : "s"}.`
        : `Hidden ${visible.length} of ${selected.length} selected elements.`,
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
    if (target.kind === "part") return;
    const runtime = this.options.runtime();
    if (runtime.getPartOccurrence(target.partOccurrenceId) === undefined) return;
    this.setPartOccurrence(
      target.partOccurrenceId,
      !runtime.isPartOccurrenceVisible(target.partOccurrenceId),
    );
  }

  togglePart(target: SelectTarget): void {
    const partId = target.kind === "part" ? target.partId : this.partForTarget(target);
    if (partId === undefined) return;
    this.setPart(partId, !this.partVisible(partId));
  }

  /** Restores every current model-visibility bit without changing interaction emphasis. */
  showAll(): void {
    const scene = this.options.scene();
    const runtime = this.options.runtime();
    let interaction = this.options.interaction();
    for (const instance of runtime.getPartOccurrences()) {
      const part = scene.parts.get(instance.partId);
      for (const body of part?.bodies ?? []) {
        interaction = setBodyVisible(
          interaction,
          { partOccurrenceId: instance.partOccurrenceId, bodyId: body.id },
          true,
        );
      }
      for (const element of part?.elements ?? []) {
        interaction = setElementVisible(
          interaction,
          { partOccurrenceId: instance.partOccurrenceId, elementId: element.id },
          true,
        );
      }
    }
    this.options.applyInteraction(interaction);
    const viewport = this.options.viewport();
    viewport.batch(() => {
      for (const assemblyId of scene.assemblies.keys()) {
        viewport.visibility.setAssembly(assemblyId, true);
      }
      for (const occurrenceId of runtime.getOccurrenceIds()) {
        viewport.visibility.setAssemblyOccurrence(occurrenceId, true);
      }
      for (const partId of scene.parts.keys()) {
        viewport.visibility.setPart(partId, true);
      }
      for (const partOccurrenceId of runtime.getPartOccurrenceIds()) {
        viewport.visibility.setPartOccurrence(partOccurrenceId, true);
      }
    });
    this.finish();
  }

  partVisible(partId: PartId): boolean {
    const runtime = this.options.runtime();
    for (const partOccurrenceId of runtime.getPartOccurrenceIds()) {
      if (runtime.getPartId(partOccurrenceId) !== partId) continue;
      return runtime.getPartOccurrence(partOccurrenceId)?.partVisible ?? false;
    }
    return false;
  }

  bodyVisible(partOccurrenceId: PartOccurrenceId, bodyId: BodyId): boolean {
    return isBodyVisible(this.options.interaction(), { partOccurrenceId, bodyId });
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
    return this.options.runtime().getPartId(target.partOccurrenceId);
  }

  private finish(render = true): void {
    this.options.syncPanel();
    if (render) this.options.render();
  }
}
