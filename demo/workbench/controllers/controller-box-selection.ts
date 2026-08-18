import {
  visibleSurfaceBoxSelectionResolver,
  type BoxSelectionStrategy,
} from "../selection/box-selection-resolver";
import { throughIntersectionBoxSelectionResolver } from "../selection/through-box-selection";
import type { SelectionGranularity } from "../selection/pick";
import type { WorkbenchViewportSlots } from "../viewport/viewport-slots";
import { clearTransientHover, type WorkbenchHoverController } from "./controller-hover";
import type { TouchInteractionMode } from "../types";

interface BoxSelectionOwner {
  boxSelectionStrategy: BoxSelectionStrategy;
  elementBoxSelectionStrategy?: BoxSelectionStrategy;
  readonly selectionGranularity: SelectionGranularity;
  readonly showState?: (slotId: "primary" | "secondary") => {
    boxSelectionStrategy: BoxSelectionStrategy;
    elementBoxSelectionStrategy: BoxSelectionStrategy;
    readonly selectionGranularity: SelectionGranularity;
  };
  readonly viewportSlots: WorkbenchViewportSlots;
  render(): void;
}

/** Applies the element-only strategy rule when selection granularity changes. */
export function normalizeBoxSelectionStrategyForGranularity(owner: BoxSelectionOwner): void {
  owner.boxSelectionStrategy =
    owner.selectionGranularity === "element"
      ? (owner.elementBoxSelectionStrategy ?? owner.boxSelectionStrategy)
      : "visible-surface";
}

/** Rebuilds resolver closures for every current viewport and invalidates stale work. */
export function applyBoxSelectionResolvers(owner: BoxSelectionOwner): void {
  for (const slot of owner.viewportSlots.all()) {
    const viewport = () => slot.viewport;
    const state = owner.showState?.(slot.id);
    const strategy = state?.boxSelectionStrategy ?? owner.boxSelectionStrategy;
    slot.interaction.setBoxSelectionResolver(
      strategy === "through-intersection"
        ? throughIntersectionBoxSelectionResolver(viewport)
        : visibleSurfaceBoxSelectionResolver(viewport),
    );
  }
}

/** Changes the shared strategy while keeping the presentation value truthful. */
export function setBoxSelectionStrategy(owner: BoxSelectionOwner, value: string): void {
  const strategy = parseBoxSelectionStrategy(value);
  if (strategy === undefined) return;
  if (owner.showState === undefined) {
    if (owner.selectionGranularity === "element") owner.elementBoxSelectionStrategy = strategy;
  } else {
    for (const slot of owner.viewportSlots.all()) {
      const state = owner.showState(slot.id);
      state.elementBoxSelectionStrategy = strategy;
      state.boxSelectionStrategy =
        state.selectionGranularity === "element" ? strategy : "visible-surface";
    }
  }
  normalizeBoxSelectionStrategyForGranularity(owner);
  applyBoxSelectionResolvers(owner);
  owner.render();
}

interface TouchSelectionOwner extends WorkbenchHoverController {
  touchInteractionMode: TouchInteractionMode;
}

/** Routes one-finger touch between camera navigation, hover inspection, and box selection. */
export function setTouchInteractionMode(owner: TouchSelectionOwner, value: string): void {
  if (value !== "navigate" && value !== "hover" && value !== "box-select") return;
  if (owner.touchInteractionMode === value) return;
  owner.touchInteractionMode = value;
  clearTransientHover(owner);
  owner.render();
}

function parseBoxSelectionStrategy(value: string): BoxSelectionStrategy | undefined {
  return value === "visible-surface" || value === "through-intersection" ? value : undefined;
}
