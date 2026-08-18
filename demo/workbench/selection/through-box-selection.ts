import {
  boxSelectionFrustum,
  isBodyVisible,
  isElementVisible,
  type InteractionTarget,
  type Viewport,
} from "../../../src/entries/root";
import {
  BoxSelectionResolverContractError,
  type BoxSelectionResolver,
} from "./box-selection-resolver";
import { elementIntersectsBox, queryData, type MutableVec3 } from "./through-box-geometry";

/**
 * Creates the Core through-intersection resolver for element box selection.
 *
 * The query walks the runtime draw list and the authoritative part tessellation
 * on the host. It intentionally has no renderer or GPU dependency, so it can
 * share the workbench's existing asynchronous box-selection queue.
 */
export function throughIntersectionBoxSelectionResolver(
  viewport: () => Viewport,
): BoxSelectionResolver {
  return ({ event, granularity }) => {
    if (granularity !== "element") {
      throw new BoxSelectionResolverContractError(
        "Through box selection requires element granularity",
      );
    }
    const view = viewport();
    const frustum = boxSelectionFrustum(view.view.camera, event.rect);
    const tolerance = selectionTolerance(view);
    const deformation = view.results.state?.deformation;
    const targets: InteractionTarget[] = [];
    const points: MutableVec3[] = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ];

    for (const partOccurrenceId of view.runtime.getVisiblePartOccurrenceIds()) {
      const instance = view.runtime.getPartOccurrence(partOccurrenceId);
      if (instance === undefined || !instance.visible || !instance.partVisible) continue;
      const occurrence = view.runtime.getOccurrence(instance.occurrenceId);
      if (occurrence === undefined || !occurrence.effectiveVisible) continue;
      const part = view.scene.parts.get(instance.partId);
      if (part === undefined) continue;
      const partQuery = queryData(part);
      for (let elementIndex = 0; elementIndex < partQuery.elements.length; elementIndex += 1) {
        const element = partQuery.elements[elementIndex];
        if (element === undefined) continue;
        if (
          !isElementVisible(view.interaction.state, { partOccurrenceId, elementId: element.id })
        ) {
          continue;
        }
        if (
          element.bodyId !== undefined &&
          !isBodyVisible(view.interaction.state, { partOccurrenceId, bodyId: element.bodyId })
        ) {
          continue;
        }
        if (
          elementIntersectsBox({
            part,
            element,
            geometryByPrimitive: partQuery.geometryByPrimitive,
            transform: instance.transform,
            frustum,
            sectionPlane: view.presentation.sectionPlane,
            deformation,
            tolerance,
            elementBounds: partQuery.elementBounds,
            elementIndex,
            points,
          })
        ) {
          targets.push({ kind: "element", partOccurrenceId, elementId: element.id });
        }
      }
    }
    return Promise.resolve(targets);
  };
}

function selectionTolerance(view: Viewport): number {
  const cameraScale = Math.max(
    1,
    view.view.camera.orthoHeight,
    Math.hypot(
      view.view.camera.position[0] - view.view.camera.target[0],
      view.view.camera.position[1] - view.view.camera.target[1],
      view.view.camera.position[2] - view.view.camera.target[2],
    ),
  );
  return cameraScale * 1e-7;
}
