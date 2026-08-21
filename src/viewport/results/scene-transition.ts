import type { PackedSceneRuntime } from "../../scene-runtime/runtime";
import type { Scene } from "../../scene/scene";
import {
  resolveViewportPartRevisionResults,
  resolveViewportResults,
  type ViewportResultsState,
} from "../results";
import type { SceneUpdateOutcome } from "../types";

export interface PreparedSceneResults {
  readonly results: ViewportResultsState | undefined;
  readonly outcome: SceneUpdateOutcome;
}

/** Resolves the retained result configuration against a replacement scene runtime. */
export function prepareSceneResults(
  previous: ViewportResultsState | undefined,
  scene: Scene,
  runtime: PackedSceneRuntime,
): PreparedSceneResults {
  if (previous === undefined) return { results: undefined, outcome: { results: "none" } };
  try {
    return {
      results: resolveViewportResults(previous.config, scene, runtime, previous),
      outcome: { results: "preserved" },
    };
  } catch (error: unknown) {
    return clearedResults(error);
  }
}

/** Resolves retained results for a sparse set of revised part definitions. */
export function preparePartRevisionResults(
  previous: ViewportResultsState | undefined,
  scene: Scene,
  runtime: PackedSceneRuntime,
  partIds: ReadonlySet<number>,
): PreparedSceneResults {
  if (previous === undefined) return { results: undefined, outcome: { results: "none" } };
  try {
    return {
      results: resolveViewportPartRevisionResults(
        previous.config,
        scene,
        runtime,
        previous,
        partIds,
      ),
      outcome: { results: "preserved" },
    };
  } catch (error: unknown) {
    return clearedResults(error);
  }
}

function clearedResults(error: unknown): PreparedSceneResults {
  return {
    results: undefined,
    outcome: { results: "cleared", reason: error instanceof Error ? error.message : String(error) },
  };
}
