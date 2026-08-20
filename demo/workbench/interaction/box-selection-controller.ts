import type { InteractionState, InteractionTarget } from "@/entries/interaction";
import { selectedTargetCount } from "@/interaction/selection-queries";
import {
  BoxSelectionResolverContractError,
  validateBoxSelectionTargets,
  type BoxSelectionRequest,
  type BoxSelectionResolver,
} from "../selection/box-selection-resolver";
import { appendTargets, replaceTargets } from "../selection/selection";
import type { SelectionGranularity, SelectTarget } from "../selection/pick";

export interface WorkbenchBoxSelectionControllerOptions {
  readonly getInteraction: () => InteractionState;
  readonly setInteraction: (interaction: InteractionState) => void;
  readonly render: () => void;
  readonly selectionFeedback: ((message: string) => void) | undefined;
  readonly isDisposed: () => boolean;
  readonly resolver: BoxSelectionResolver;
}

/** Owns serialized box-query readbacks and their stale-result policy. */
export class WorkbenchBoxSelectionController {
  private generation = 0;
  private active = false;
  private queued:
    { readonly request: BoxSelectionRequest; readonly resolver: BoxSelectionResolver } | undefined;
  private drain: Promise<void> | undefined;
  private queriesStarted = 0;
  private queriesInFlight = 0;
  private maxInFlight = 0;
  private selectionResolver: BoxSelectionResolver;

  constructor(private readonly options: WorkbenchBoxSelectionControllerOptions) {
    this.selectionResolver = options.resolver;
  }

  setResolver(resolver: BoxSelectionResolver): void {
    if (this.selectionResolver === resolver) return;
    this.selectionResolver = resolver;
    this.invalidate();
  }

  resolver(): BoxSelectionResolver {
    return this.selectionResolver;
  }

  queue(request: BoxSelectionRequest): Promise<void> {
    this.queued = { request, resolver: this.selectionResolver };
    this.generation += 1;
    if (this.drain === undefined) this.drain = this.drainQueries();
    return this.drain;
  }

  invalidate(): void {
    this.queued = undefined;
    this.generation += 1;
  }

  stats(): {
    readonly active: boolean;
    readonly queued: boolean;
    readonly started: number;
    readonly maxActive: number;
  } {
    return {
      active: this.active,
      queued: this.queued !== undefined,
      started: this.queriesStarted,
      maxActive: this.maxInFlight,
    };
  }

  isActive(): boolean {
    return this.active || this.queued !== undefined;
  }

  private async drainQueries(): Promise<void> {
    this.queriesStarted += 1;
    this.queriesInFlight += 1;
    this.maxInFlight = Math.max(this.maxInFlight, this.queriesInFlight);
    this.active = true;
    try {
      while (!this.options.isDisposed() && this.queued !== undefined) {
        const queued = this.queued;
        this.queued = undefined;
        const generation = this.generation;
        let targets: readonly InteractionTarget[];
        try {
          targets = validateBoxSelectionTargets(
            await queued.resolver(queued.request),
            queued.request.granularity,
          );
        } catch (error: unknown) {
          if (this.isCurrent(generation)) this.reportError(error);
          continue;
        }
        if (!this.isCurrent(generation)) continue;
        this.apply(queued.request, targets);
      }
    } finally {
      this.queriesInFlight -= 1;
      this.active = this.queriesInFlight > 0;
      this.drain = undefined;
    }
  }

  private apply(request: BoxSelectionRequest, targets: readonly InteractionTarget[]): void {
    const selectable = selectableTargets(targets);
    const current = this.options.getInteraction();
    const next =
      request.event.modifiers.control || request.event.modifiers.meta
        ? appendTargets(current, selectable)
        : replaceTargets(current, selectable);
    const selectedCount = selectedTargetCount(next, request.granularity);
    this.options.selectionFeedback?.(
      `Box selection: ${selectedCount} ${selectionNoun(request.granularity, selectedCount)}`,
    );
    if (next === current) return;
    this.options.setInteraction(next);
    this.options.render();
  }

  private reportError(error: unknown): void {
    this.options.selectionFeedback?.(
      error instanceof BoxSelectionResolverContractError
        ? `Box selection failed: ${error.message}`
        : "Box selection failed: GPU pick readback could not be completed",
    );
  }

  private isCurrent(generation: number): boolean {
    return !this.options.isDisposed() && generation === this.generation;
  }
}

function selectableTargets(targets: readonly InteractionTarget[]): SelectTarget[] {
  return [...targets];
}

function selectionNoun(granularity: SelectionGranularity, count: number): string {
  const noun = granularity === "element" ? "FE element" : granularity;
  return `${noun}${count === 1 ? "" : "s"}`;
}
