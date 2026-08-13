import {
  clientToCanvasCss,
  isElementVisible,
  isTargetSelected,
  selectedTargets,
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

type CompletedBoxSelectionEvent = BoxSelectionEvent & { readonly type: "complete" };

function isCompletedBoxSelectionEvent(
  event: BoxSelectionEvent,
): event is CompletedBoxSelectionEvent {
  return event.type === "complete";
}

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
  /** Optional concise feedback sink for completed box-selection results. */
  readonly selectionFeedback?: (message: string) => void;
}

/** Owns async pick ordering, hover state, click selection, and context targets. */
export class WorkbenchInteraction {
  private readonly options: WorkbenchInteractionOptions;
  private generation = 0;
  private disposed = false;
  private downPosition: { readonly x: number; readonly y: number } | undefined;
  private target: SelectTarget | undefined;
  private boxSelectionActive = false;
  private queuedBoxSelection: CompletedBoxSelectionEvent | undefined;
  private boxSelectionDrain: Promise<void> | undefined;
  private boxSelectionQueriesStarted = 0;
  private boxSelectionQueriesInFlight = 0;
  private boxSelectionMaxInFlight = 0;

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
    if (this.boxSelectionActive || this.queuedBoxSelection !== undefined) return;
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
    this.invalidatePendingQuery();
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
    this.invalidatePendingQuery();
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
    if (!isCompletedBoxSelectionEvent(event)) return;
    if (this.disposed) return;
    this.queuedBoxSelection = event;
    this.generation += 1;
    if (this.boxSelectionDrain === undefined) {
      this.boxSelectionDrain = this.drainBoxSelections();
    }
    await this.boxSelectionDrain;
  }

  getBoxSelectionStats(): {
    readonly active: boolean;
    readonly queued: boolean;
    readonly started: number;
    readonly maxActive: number;
  } {
    return {
      active: this.boxSelectionActive,
      queued: this.queuedBoxSelection !== undefined,
      started: this.boxSelectionQueriesStarted,
      maxActive: this.boxSelectionMaxInFlight,
    };
  }

  private invalidatePendingQuery(): void {
    this.queuedBoxSelection = undefined;
    this.generation += 1;
  }

  private async drainBoxSelections(): Promise<void> {
    this.boxSelectionQueriesStarted += 1;
    this.boxSelectionQueriesInFlight += 1;
    this.boxSelectionMaxInFlight = Math.max(
      this.boxSelectionMaxInFlight,
      this.boxSelectionQueriesInFlight,
    );
    this.boxSelectionActive = true;
    try {
      while (!this.disposed && this.queuedBoxSelection !== undefined) {
        const event = this.queuedBoxSelection;
        this.queuedBoxSelection = undefined;
        const generation = this.generation;
        let targets: readonly InteractionTarget[];
        try {
          targets = await this.options.viewport().pickRegion(event.rect, "element");
        } catch {
          if (this.isCurrentQuery(generation)) {
            this.options.selectionFeedback?.(
              "Box selection failed: GPU pick readback could not be completed",
            );
          }
          continue;
        }
        if (!this.isCurrentQuery(generation)) continue;
        this.applyBoxSelection(event, targets);
      }
    } finally {
      this.boxSelectionQueriesInFlight -= 1;
      this.boxSelectionActive = this.boxSelectionQueriesInFlight > 0;
      this.boxSelectionDrain = undefined;
    }
  }

  private applyBoxSelection(
    event: CompletedBoxSelectionEvent,
    targets: readonly InteractionTarget[],
  ): void {
    const elements = elementTargets(targets);
    const current = this.options.getInteraction();
    const next =
      event.modifiers.control || event.modifiers.meta
        ? toggleElementSelections(current, elements)
        : replaceElementSelection(current, elements);
    const selectedElementCount = selectedTargets(next).filter(
      (target) => target.kind === "element",
    ).length;
    this.options.selectionFeedback?.(
      `Box selection: ${selectedElementCount} FE element${selectedElementCount === 1 ? "" : "s"}`,
    );
    if (next === current) return;
    this.options.setInteraction(next);
    this.options.render();
  }

  private isCurrentQuery(generation: number): boolean {
    return !this.disposed && generation === this.generation;
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
      element?.kind !== "element"
        ? undefined
        : isTargetSelected(interaction, element)
          ? "Deselect element"
          : "Select element",
    elementVisibilityLabel:
      element?.kind !== "element"
        ? undefined
        : isElementVisible(interaction, element)
          ? "Hide element"
          : "Show element",
  };
}

function selectionLabel(target: SelectTarget, interaction: InteractionState): string {
  if (target.kind !== "node" && target.kind !== "face") return "Select / Deselect";
  return `${isTargetSelected(interaction, target) ? "Deselect" : "Select"} ${target.kind}`;
}
