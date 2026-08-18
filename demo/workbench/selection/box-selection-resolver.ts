import type { Viewport } from "../../../src/entries/root";
import type { BoxSelectionEvent, InteractionTarget } from "../../../src/entries/interaction";
import type { SelectionGranularity } from "./pick";

/** Candidate discovery strategy shared by every workbench viewport. */
export type BoxSelectionStrategy = "visible-surface" | "through-intersection";

/** A completed box gesture plus the target kind captured for its query. */
export interface BoxSelectionRequest {
  readonly event: Extract<BoxSelectionEvent, { readonly type: "start" | "change" | "complete" }> & {
    readonly type: "complete";
  };
  readonly granularity: SelectionGranularity;
}

/** Candidate discovery for one completed workbench box-selection request. */
export type BoxSelectionResolver = (
  request: BoxSelectionRequest,
) => Promise<readonly InteractionTarget[]>;

/** Identifies a custom resolver result that cannot be applied safely. */
export class BoxSelectionResolverContractError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = "BoxSelectionResolverContractError";
  }
}

/** Creates the default nearest-visible resolver around the active viewport. */
export function visibleSurfaceBoxSelectionResolver(viewport: () => Viewport): BoxSelectionResolver {
  return ({ event, granularity }) => viewport().interaction.pickRegion(event.rect, granularity);
}

/** Verifies custom candidates at the boundary before selection policy consumes them. */
export function validateBoxSelectionTargets(
  targets: readonly InteractionTarget[],
  granularity: SelectionGranularity,
): readonly InteractionTarget[] {
  for (const target of targets) {
    if (target.kind !== granularity) {
      throw new BoxSelectionResolverContractError(
        `Box selection resolver returned ${target.kind} target; expected ${granularity} target`,
      );
    }
  }
  return targets;
}
