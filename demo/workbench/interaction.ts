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
import {
  validateBoxSelectionTargets,
  visibleSurfaceBoxSelectionResolver,
  type BoxSelectionRequest,
  type BoxSelectionResolver,
  BoxSelectionResolverContractError,
} from "./box-selection-resolver";
import {
  exactTarget,
  elementTarget,
  selectTarget,
  targetKey,
  type SelectionGranularity,
  type SelectTarget,
} from "./pick";
import {
  clearSelection as clearSelectedTargets,
  replaceSelection,
  toggleHighlight,
  toggleElementSelection,
  replaceTargets,
  toggleTargets,
  toggleSelection,
} from "./selection";
import type { WorkbenchMenu, WorkbenchMenuSelectionOptions } from "./menu";
import {
  mergeModifiers,
  modifiersOf,
  type HoverPick,
  type PointerModifiers,
} from "./interaction-pointer";

type CompletedBoxSelectionEvent = BoxSelectionRequest["event"];

function isCompletedBoxSelectionEvent(
  event: BoxSelectionEvent,
): event is CompletedBoxSelectionEvent {
  return event.type === "complete";
}

/** View and state hooks used by the asynchronous picking interaction layer. */
export interface WorkbenchInteractionOptions {
  readonly canvas: HTMLCanvasElement;
  readonly viewport: () => FemViewport;
  readonly getInteraction: () => InteractionState;
  readonly setInteraction: (interaction: InteractionState) => void;
  readonly partName: (partId: PartId) => string | undefined;
  readonly menu: WorkbenchMenu;
  readonly render: () => void;
  readonly selectionGranularity: () => SelectionGranularity;
  readonly setInspection: (text: string, visible: boolean) => void;
  readonly boxSelectionResolver?: BoxSelectionResolver;
  /** Optional concise feedback sink for completed box-selection results. */
  readonly selectionFeedback?: (message: string) => void;
}

/** Owns async pick ordering, hover state, click selection, and context targets. */
export class WorkbenchInteraction {
  private readonly options: WorkbenchInteractionOptions;
  private generation = 0;
  private disposed = false;
  private downPosition: { readonly x: number; readonly y: number } | undefined;
  private downModifiers: PointerModifiers | undefined;
  private skipNextClick = false;
  private hoverPick: HoverPick | undefined;
  private target: SelectTarget | undefined;
  private boxSelectionActive = false;
  private queuedBoxSelection:
    { readonly request: BoxSelectionRequest; readonly resolver: BoxSelectionResolver } | undefined;
  private boxSelectionResolver: BoxSelectionResolver;
  private boxSelectionDrain: Promise<void> | undefined;
  private boxSelectionQueriesStarted = 0;
  private boxSelectionQueriesInFlight = 0;
  private boxSelectionMaxInFlight = 0;

  constructor(options: WorkbenchInteractionOptions) {
    this.options = options;
    this.boxSelectionResolver =
      options.boxSelectionResolver ?? visibleSurfaceBoxSelectionResolver(options.viewport);
  }

  get contextTarget(): SelectTarget | undefined {
    return this.target;
  }

  pointerDown(event: PointerEvent): void {
    if (event.pointerType === "touch") this.skipNextClick = false;
    this.downPosition = { x: event.clientX, y: event.clientY };
    this.downModifiers = modifiersOf(event);
  }

  pointerCancel(): void {
    this.downPosition = undefined;
    this.downModifiers = undefined;
    this.hoverPick = undefined;
    this.invalidatePendingQuery();
  }

  /** Completes a touch tap without relying on a browser-synthesized click. */
  pointerUp(event: PointerEvent): void {
    if (event.pointerType !== "touch") return;
    void this.click(event);
    this.skipNextClick = true;
  }

  async hover(event: PointerEvent): Promise<void> {
    if (this.boxSelectionActive || this.queuedBoxSelection !== undefined) return;
    const generation = ++this.generation;
    const hit = await this.resolve(event, generation);
    if (generation !== this.generation) return;
    this.hoverPick =
      hit === undefined ? undefined : { clientX: event.clientX, clientY: event.clientY, hit };
    const target =
      hit === undefined ? undefined : selectTarget(hit, this.options.selectionGranularity(), event);
    let interaction = this.options.getInteraction();
    interaction = setTargetHovered(interaction, target);
    this.options.setInteraction(interaction);
    this.options.canvas.dataset["hovered"] = targetKey(target);
    this.options.canvas.dataset["pick"] = targetKey(hit);
    this.showPick(hit);
    this.options.render();
  }

  async click(event: MouseEvent): Promise<void> {
    if (this.skipNextClick) {
      this.skipNextClick = false;
      return;
    }
    const down = this.downPosition;
    this.downPosition = undefined;
    const modifiers = mergeModifiers(event, this.downModifiers);
    this.downModifiers = undefined;
    if (down !== undefined && Math.hypot(event.clientX - down.x, event.clientY - down.y) > 10)
      return;
    this.invalidatePendingQuery();
    const generation = ++this.generation;
    const hit = this.hoverHitAt(event) ?? (await this.resolve(event, generation));
    if (generation !== this.generation) return;
    const current = this.options.getInteraction();
    const withoutHover = setTargetHovered(current, undefined);
    const hoverCleared = withoutHover !== current;
    if (hit === undefined) {
      if (modifiers.ctrlKey || modifiers.metaKey) {
        if (hoverCleared) {
          this.options.setInteraction(withoutHover);
          this.options.render();
        }
        this.showPick(undefined);
        return;
      }
      this.options.setInteraction(clearSelectedTargets(withoutHover));
      this.options.render();
      this.showPick(undefined);
      return;
    }
    this.showPick(hit);
    const target = selectTarget(hit, this.options.selectionGranularity(), modifiers);
    if (target === undefined) {
      if (modifiers.ctrlKey || modifiers.metaKey) {
        if (hoverCleared) {
          this.options.setInteraction(withoutHover);
          this.options.render();
        }
      } else {
        this.options.setInteraction(clearSelectedTargets(withoutHover));
        this.options.render();
      }
      return;
    }
    this.options.setInteraction(
      modifiers.ctrlKey || modifiers.metaKey
        ? toggleSelection(withoutHover, target)
        : replaceSelection(withoutHover, target),
    );
    this.options.render();
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

  /** Clears transient hover and invalidates an older asynchronous hover query. */
  clearHover(): void {
    this.invalidatePendingQuery();
    const current = this.options.getInteraction();
    const next = setTargetHovered(current, undefined);
    if (next !== current) this.options.setInteraction(next);
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
    this.target = hit === undefined ? undefined : exactTarget(hit, event);
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
    this.hoverPick = undefined;
    this.invalidatePendingQuery();
    this.options.menu.hide();
  }

  /** Replaces candidate discovery and invalidates work captured for the old resolver. */
  setBoxSelectionResolver(resolver: BoxSelectionResolver): void {
    if (this.boxSelectionResolver === resolver) return;
    this.boxSelectionResolver = resolver;
    this.invalidatePendingQuery();
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

  private hoverHitAt(event: {
    readonly clientX: number;
    readonly clientY: number;
  }): HoverPick["hit"] | undefined {
    const pick = this.hoverPick;
    if (pick === undefined) return undefined;
    return Math.hypot(event.clientX - pick.clientX, event.clientY - pick.clientY) <= 2
      ? pick.hit
      : undefined;
  }

  /** Selects the visible elements returned for one completed primary drag. */
  async selectBox(event: BoxSelectionEvent): Promise<void> {
    if (!isCompletedBoxSelectionEvent(event)) return;
    if (this.disposed) return;
    this.queuedBoxSelection = {
      request: { event, granularity: this.options.selectionGranularity() },
      resolver: this.boxSelectionResolver,
    };
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
        const queued = this.queuedBoxSelection;
        this.queuedBoxSelection = undefined;
        const generation = this.generation;
        let targets: readonly InteractionTarget[];
        try {
          targets = validateBoxSelectionTargets(
            await queued.resolver(queued.request),
            queued.request.granularity,
          );
        } catch (error: unknown) {
          if (this.isCurrentQuery(generation)) {
            this.options.selectionFeedback?.(
              error instanceof BoxSelectionResolverContractError
                ? `Box selection failed: ${error.message}`
                : "Box selection failed: GPU pick readback could not be completed",
            );
          }
          continue;
        }
        if (!this.isCurrentQuery(generation)) continue;
        this.applyBoxSelection(queued.request, targets);
      }
    } finally {
      this.boxSelectionQueriesInFlight -= 1;
      this.boxSelectionActive = this.boxSelectionQueriesInFlight > 0;
      this.boxSelectionDrain = undefined;
    }
  }

  private applyBoxSelection(
    request: BoxSelectionRequest,
    targets: readonly InteractionTarget[],
  ): void {
    const selectable = selectableTargets(targets);
    const granularity = request.granularity;
    const current = this.options.getInteraction();
    const next =
      request.event.modifiers.control || request.event.modifiers.meta
        ? toggleTargets(current, selectable)
        : replaceTargets(current, selectable);
    const selectedTargetCount = selectedTargets(next).filter(
      (target) => target.kind === granularity,
    ).length;
    this.options.selectionFeedback?.(
      `Box selection: ${selectedTargetCount} ${selectionNoun(granularity, selectedTargetCount)}`,
    );
    if (next === current) return;
    this.options.setInteraction(next);
    this.options.render();
  }

  private isCurrentQuery(generation: number): boolean {
    return !this.disposed && generation === this.generation;
  }

  private showPick(hit: Parameters<typeof describePick>[0]): void {
    const text = describePick(
      hit,
      (partId) => this.options.partName(partId),
      this.options.viewport().results,
    );
    this.options.setInspection(text, hit !== undefined);
  }
}

function selectableTargets(targets: readonly InteractionTarget[]): SelectTarget[] {
  return targets.filter((target): target is SelectTarget => target.kind !== "body");
}

function selectionNoun(granularity: SelectionGranularity, count: number): string {
  const noun = granularity === "element" ? "FE element" : granularity;
  return `${noun}${count === 1 ? "" : "s"}`;
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
