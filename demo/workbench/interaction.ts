import {
  clientToCanvasCss,
  isTargetSelected,
  setTargetHovered,
  type FemViewport,
  type InteractionState,
  type PartId,
  type PickHit,
} from "../../src/index";
import type { BoxSelectionEvent, InteractionTarget } from "../../src/index";
import { describePick } from "./inspect";
import { elementTarget, selectTarget, targetKey, type SelectTarget } from "./pick";
import {
  clearSelection as clearSelectedTargets,
  replaceSelection,
  toggleHighlight,
  toggleElementSelection,
  replaceElementSelection,
  toggleElementSelections,
  toggleSelection,
} from "./selection";
import type { WorkbenchMenu, WorkbenchMenuSelectionOptions } from "./menu";

/** View and state hooks used by the asynchronous picking interaction layer. */
export interface WorkbenchInteractionOptions {
  readonly canvas: HTMLCanvasElement;
  readonly view: {
    readonly inspectionPanel: HTMLElement;
  };
  readonly viewport: () => FemViewport;
  readonly getInteraction: () => InteractionState;
  readonly setInteraction: (interaction: InteractionState) => void;
  readonly partName: (partId: PartId) => string | undefined;
  readonly menu: WorkbenchMenu;
  readonly render: () => void;
}

/** Owns async pick ordering, hover state, click selection, and context targets. */
export class WorkbenchInteraction {
  private readonly options: WorkbenchInteractionOptions;
  private generation = 0;
  private disposed = false;
  private downPosition: { readonly x: number; readonly y: number } | undefined;
  private target: SelectTarget | undefined;
  private boxSelectionPending = false;

  constructor(options: WorkbenchInteractionOptions) {
    this.options = options;
  }

  get contextTarget(): SelectTarget | undefined {
    return this.target;
  }

  pointerDown(event: PointerEvent): void {
    this.downPosition = { x: event.clientX, y: event.clientY };
  }

  pointerCancel(): void {
    this.downPosition = undefined;
    this.invalidatePendingQuery();
  }

  async hover(event: PointerEvent): Promise<void> {
    if (this.boxSelectionPending) return;
    const generation = ++this.generation;
    const hit = await this.resolve(event, generation);
    if (generation !== this.generation) return;
    const target = hit === undefined ? undefined : selectTarget(hit, event);
    let interaction = this.options.getInteraction();
    interaction = setTargetHovered(interaction, target);
    this.options.setInteraction(interaction);
    this.options.canvas.dataset["hovered"] = targetKey(target);
    this.options.canvas.dataset["pick"] = targetKey(hit);
    this.showPick(hit);
    this.options.render();
  }

  async click(event: MouseEvent): Promise<void> {
    const down = this.downPosition;
    this.downPosition = undefined;
    if (down !== undefined && Math.hypot(event.clientX - down.x, event.clientY - down.y) > 10)
      return;
    this.boxSelectionPending = false;
    const generation = ++this.generation;
    const hit = await this.resolve(event, generation);
    if (generation !== this.generation) return;
    if (hit === undefined) {
      this.clearSelection();
      this.showPick(undefined);
      return;
    }
    const target = selectTarget(hit, event);
    if (target === undefined) return;
    if (event.ctrlKey || event.metaKey) this.select(target);
    else this.replace(target);
  }

  select(target: SelectTarget): void {
    this.invalidatePendingQuery();
    this.options.setInteraction(toggleSelection(this.options.getInteraction(), target));
    this.options.render();
  }

  selectElement(target: SelectTarget): void {
    this.invalidatePendingQuery();
    this.options.setInteraction(toggleElementSelection(this.options.getInteraction(), target));
    this.options.render();
  }

  replace(target: SelectTarget): void {
    this.invalidatePendingQuery();
    this.options.setInteraction(replaceSelection(this.options.getInteraction(), target));
    this.options.render();
  }

  clearSelection(): void {
    this.invalidatePendingQuery();
    this.options.setInteraction(clearSelectedTargets(this.options.getInteraction()));
    this.options.render();
  }

  highlight(target: SelectTarget): void {
    this.invalidatePendingQuery();
    this.options.setInteraction(toggleHighlight(this.options.getInteraction(), target));
    this.options.render();
  }

  async contextMenu(event: MouseEvent): Promise<void> {
    event.preventDefault();
    this.boxSelectionPending = false;
    const generation = ++this.generation;
    const hit = await this.resolve(event, generation);
    if (generation !== this.generation) return;
    this.target = hit === undefined ? undefined : selectTarget(hit, event);
    if (this.target === undefined) {
      this.showPick(undefined);
      this.options.menu.showView(event.clientX, event.clientY);
      return;
    }
    this.showPick(hit);
    this.options.menu.show(
      this.target,
      event.clientX,
      event.clientY,
      contextMenuSelectionOptions(this.target, this.options.getInteraction()),
    );
  }

  clearContext(): void {
    this.target = undefined;
    this.invalidatePendingQuery();
    this.options.menu.hide();
  }

  destroy(): void {
    this.disposed = true;
    this.clearContext();
    this.downPosition = undefined;
  }

  private async resolve(
    event: {
      readonly clientX: number;
      readonly clientY: number;
    },
    generation: number,
  ): Promise<PickHit | undefined> {
    const rect = this.options.canvas.getBoundingClientRect();
    const point = clientToCanvasCss(event.clientX, event.clientY, rect);
    try {
      return await this.options.viewport().pick(point.x, point.y);
    } catch (error: unknown) {
      if (this.disposed || generation !== this.generation) return undefined;
      throw error;
    }
  }

  /** Selects the visible elements returned for one completed primary drag. */
  async selectBox(event: BoxSelectionEvent): Promise<void> {
    if (event.type !== "complete") return;
    const generation = ++this.generation;
    this.boxSelectionPending = true;
    try {
      const targets = await this.options.viewport().pickRegion(event.rect, "element");
      if (this.disposed || generation !== this.generation) return;
      const elements = elementTargets(targets);
      const current = this.options.getInteraction();
      const next =
        event.modifiers.control || event.modifiers.meta
          ? toggleElementSelections(current, elements)
          : replaceElementSelection(current, elements);
      if (next === current) return;
      this.options.setInteraction(next);
      this.options.render();
    } catch {
      // A rejected region query has no selection result to apply.
    } finally {
      if (generation === this.generation) this.boxSelectionPending = false;
    }
  }

  private invalidatePendingQuery(): void {
    this.boxSelectionPending = false;
    this.generation += 1;
  }

  private showPick(hit: Parameters<typeof describePick>[0]): void {
    this.options.view.inspectionPanel.textContent = describePick(hit, (partId) =>
      this.options.partName(partId),
    );
    const surface = Reflect.get(this.options.view.inspectionPanel, "parentElement") as
      HTMLElement | null | undefined;
    if (surface !== null && surface !== undefined) surface.hidden = hit === undefined;
  }
}

function elementTargets(targets: readonly InteractionTarget[]): SelectTarget[] {
  return targets.filter((target): target is SelectTarget => target.kind === "element");
}

function contextMenuSelectionOptions(
  target: SelectTarget,
  interaction: InteractionState,
): WorkbenchMenuSelectionOptions {
  const element = elementTarget(target);
  return {
    selectionLabel: target.kind === "element" ? undefined : selectionLabel(target, interaction),
    elementSelectionLabel:
      element === undefined
        ? undefined
        : isTargetSelected(interaction, element)
          ? "Deselect element"
          : "Select element",
  };
}

function selectionLabel(target: SelectTarget, interaction: InteractionState): string {
  if (target.kind !== "node" && target.kind !== "face") return "Select / Deselect";
  return `${isTargetSelected(interaction, target) ? "Deselect" : "Select"} ${target.kind}`;
}
