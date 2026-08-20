import type { PartId } from "../../geometry/part";
import type { PackedSceneRuntime } from "../../scene-runtime/runtime";
import type { Scene } from "../../scene/scene";
import { mergedNodePickIds } from "../result-colors";
import { renderedPartIds } from "../results-roles";
import type { ViewportDeformationConfig } from "../results-types";

/** Validates every rendered node required by an authored deformation field. */
export function validateViewportDeformationCoverage(
  config: ViewportDeformationConfig,
  scene: Scene,
  runtime: PackedSceneRuntime,
  targetPartId: PartId | undefined,
): void {
  for (const partId of targetPartId === undefined ? renderedPartIds(runtime) : [targetPartId]) {
    const part = scene.parts.get(partId);
    if (part === undefined) continue;
    const nodePickIds = mergedNodePickIds(part);
    if (nodePickIds === undefined) {
      throw new Error(
        `Viewport deformation field ${config.field.id} cannot drive part ${part.id}: geometry has no nodePickIds`,
      );
    }
    for (const pickId of nodePickIds) {
      if (pickId > 0 && pickId > config.field.count) {
        throw new Error(
          `Viewport deformation field ${config.field.id} (count ${config.field.count}) has no value for node ${pickId - 1} in part ${part.id}`,
        );
      }
    }
  }
}
