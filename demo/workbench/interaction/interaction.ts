import { type Viewport, type PartId, type PickHit } from "@/entries/root";
import {
  setTargetHovered,
  type InteractionState,
  type ViewportInteractionApplyRequest,
  type ViewportInteractionOptions,
} from "@/entries/interaction";
import { clientToCanvasCss } from "@/entries/camera";
import { describePick } from "../selection/inspect";
import {
  visibleSurfaceBoxSelectionResolver,
  type BoxSelectionResolver,
} from "../selection/box-selection-resolver";
import {
  exactTarget,
  selectTarget,
  targetKey,
  type SelectionGranularity,
  type SelectTarget,
} from "../selection/pick";
import {
  clearSelection as clearSelectedTargets,
  replaceSelection,
  toggleHighlight,
  toggleElementSelection,
  replaceTargets,
  toggleSelection,
} from "../selection/selection";
import {
  applyViewportInteraction as applyDefaultViewportInteraction,
  reportViewportInteractionError,
  resolveViewportPoint as resolveDefaultViewportPoint,
  resolveViewportRegion as resolveDefaultViewportRegion,
} from "./viewport-binding";
import { contextMenuSelectionOptions, type WorkbenchMenu } from "./menu";
import {
  mergeModifiers,
  modifiersOf,
  type HoverPick,
  type PointerModifiers,
} from "./interaction-pointer";

/** View and state hooks used by the asynchronous picking interaction layer. */
export interface WorkbenchInteractionOptions {
  readonly canvas: HTMLCanvasElement;
  readonly viewport: () => Viewport;
  readonly getInteraction: () => InteractionState;
  readonly setInteraction: (interaction: InteractionState) => void;
  readonly partName: (partId: PartId) => string | undefined;
  readonly menu: WorkbenchMenu;
  readonly render: () => void;
  readonly selectionGranularity: () => SelectionGranularity;
  readonly touchMode?: () => "navigate" | "hover" | "box-select";
  readonly setInspection: (text: string, visible: boolean) => void;
  readonly boxSelectionResolver?: BoxSelectionResolver;
  readonly selectionFeedback?: (message: string) => void;
  readonly hoverOwnership?: {
    readonly canClear: () => boolean;
    readonly mark: () => void;
    readonly clear: () => void;
  };
}

/** Owns async pick ordering, hover state, click selection, and context targets. */
export class WorkbenchInteraction {
  private generation = 0;
  private disposed = false;
  private downPosition: { readonly x: number; readonly y: number } | undefined;
  private downModifiers: PointerModifiers | undefined;
  private skipNextClick = false;
  private hoverPick: HoverPick | undefined;
  private target: SelectTarget | undefined;
  private readonly resolvedPointHits = new WeakMap<object, PickHit | undefined>();
  private selectionResolver: BoxSelectionResolver;

  constructor(private readonly options: WorkbenchInteractionOptions) {
    this.selectionResolver =
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
    if (this.skipNextClick) return;
    this.clearHover(true);
  }

  pointerUp(event: PointerEvent): void {
    if (event.pointerType !== "touch") return;
    void (this.options.touchMode?.() === "hover" ? this.hover(event) : this.click(event));
    this.skipNextClick = true;
  }

  async hover(event: PointerEvent): Promise<void> {
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
    this.options.hoverOwnership?.mark();
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

  replaceAll(targets: readonly SelectTarget[]): void {
    this.invalidatePendingQuery();
    this.options.setInteraction(replaceTargets(this.options.getInteraction(), targets));
    this.options.render();
  }

  clearSelection(): void {
    this.invalidatePendingQuery();
    this.options.setInteraction(clearSelectedTargets(this.options.getInteraction()));
    this.options.render();
  }

  /** Clears transient hover and invalidates an older asynchronous hover query. */
  clearHover(render = false): void {
    this.invalidatePendingQuery();
    if (this.options.hoverOwnership?.canClear() === false) return;
    const current = this.options.getInteraction();
    const next = setTargetHovered(current, undefined);
    if (next !== current) this.options.setInteraction(next);
    this.options.hoverOwnership?.clear();
    if (render && next !== current) this.options.render();
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
    this.generation += 1;
    this.options.menu.hide();
  }

  /** Replaces candidate discovery and invalidates work captured for the old resolver. */
  setBoxSelectionResolver(resolver: BoxSelectionResolver): void {
    this.selectionResolver = resolver;
  }

  viewportInteractionOptions(): Pick<
    ViewportInteractionOptions,
    "resolvePoint" | "resolveRegion" | "applyInteraction" | "onError"
  > {
    return {
      resolvePoint: async (request) => {
        const resolved = await resolveDefaultViewportPoint(this.options, request);
        this.resolvedPointHits.set(request.event, resolved.hit);
        return resolved.target;
      },
      resolveRegion: ({ event, granularity }) =>
        resolveDefaultViewportRegion(this.selectionResolver, event, granularity),
      applyInteraction: (request) => {
        this.applyResolvedPoint(request);
        return applyDefaultViewportInteraction(this.options, request);
      },
      onError: (error, phase) => {
        reportViewportInteractionError(this.options, error, phase);
      },
    };
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
      return await this.options
        .viewport()
        .interaction.pick(
          point.x,
          point.y,
          this.options.selectionGranularity() === "edge" ? "edge" : undefined,
        );
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

  private invalidatePendingQuery(): void {
    this.generation += 1;
  }

  private applyResolvedPoint(request: ViewportInteractionApplyRequest): void {
    const hit = request.phase === "box" ? undefined : this.resolvedPointHits.get(request.event);
    if (request.phase !== "box") this.resolvedPointHits.delete(request.event);
    this.options.canvas.dataset["pick"] = targetKey(hit);
    this.showPick(hit);
  }

  private showPick(hit: Parameters<typeof describePick>[0]): void {
    const text = describePick(
      hit,
      (partId) => this.options.partName(partId),
      this.options.viewport().results.state,
    );
    this.options.setInspection(text, hit !== undefined);
  }
}
