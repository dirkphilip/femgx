import { type Viewport } from "@/entries/root";
import { boxSelectionFrustum, type BoxSelectionFrustum } from "@/entries/interaction";
import { type DeformationState } from "@/entries/results";
import {
  BoxSelectionResolverContractError,
  type BoxSelectionResolver,
} from "./box-selection-resolver";
import { isElementOccurrenceVisible } from "./element-visibility";
import {
  elementIntersectsBox,
  queryData,
  type ElementQuery,
  type MutableVec3,
} from "./through-box-geometry";
import { localBoundsPlanes } from "./through-box-bounds";
import { ThroughElementRegionBuilder } from "./through-element-region-builder";

interface ThroughQueryContext {
  readonly view: Viewport;
  readonly frustum: BoxSelectionFrustum;
  readonly tolerance: number;
  readonly deformation: DeformationState | undefined;
  readonly points: MutableVec3[];
  readonly selection: ThroughElementRegionBuilder;
}

interface ReusableElementQuery extends Omit<ElementQuery, "element" | "elementIndex"> {
  element: ElementQuery["element"];
  elementIndex: number;
}

/** Mutable counters for local evidence of authoritative Through query work. */
export interface ThroughBoxSelectionProbe {
  occurrencesVisited: number;
  elementsVisited: number;
  intersectionTests: number;
  selectedIdentities: number;
  groupsCreated: number;
  typedScratchGrowths: number;
  typedScratchBytes: number;
  outputTypedBytes: number;
  queryMilliseconds: number;
  packPublishMilliseconds: number;
}

/**
 * Creates the Core through-intersection resolver for element box selection.
 *
 * The query walks the runtime draw list and the authoritative part tessellation
 * on the host. It intentionally has no renderer or GPU dependency, so it can
 * share the workbench's existing asynchronous box-selection queue.
 */
export function throughIntersectionBoxSelectionResolver(
  viewport: () => Viewport,
  probe?: ThroughBoxSelectionProbe,
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
    const points: MutableVec3[] = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ];
    const context: ThroughQueryContext = {
      view,
      frustum,
      tolerance,
      deformation,
      points,
      selection: new ThroughElementRegionBuilder(),
    };
    const queryStarted = probe === undefined ? 0 : performance.now();

    for (const partOccurrenceId of view.occurrences.visiblePartOccurrenceIds()) {
      if (probe !== undefined) probe.occurrencesVisited += 1;
      appendVisibleOccurrenceTargets(context, partOccurrenceId, probe);
    }
    const packStarted = probe === undefined ? 0 : performance.now();
    const selection = context.selection.selection();
    if (probe !== undefined) {
      const details = context.selection.details();
      probe.typedScratchGrowths += details.growths;
      probe.typedScratchBytes += details.scratchBytes;
      probe.outputTypedBytes += selection.offsets.byteLength + selection.elementIds.byteLength;
      probe.queryMilliseconds += packStarted - queryStarted;
      probe.packPublishMilliseconds += performance.now() - packStarted;
    }
    return Promise.resolve(selection);
  };
}

function appendVisibleOccurrenceTargets(
  context: ThroughQueryContext,
  partOccurrenceId: string,
  probe: ThroughBoxSelectionProbe | undefined,
): void {
  const { view } = context;
  const instance = view.occurrences.getPartOccurrence(partOccurrenceId);
  if (instance === undefined || !instance.visible || !instance.partVisible) return;
  const occurrence = view.occurrences.getAssemblyOccurrence(instance.assemblyOccurrenceId);
  if (occurrence === undefined || !occurrence.effectiveVisible) return;
  const part = view.scene.parts.get(instance.partId);
  if (part === undefined) return;
  context.selection.beginOccurrence(partOccurrenceId);
  const partQuery = queryData(part);
  let elementQuery: ReusableElementQuery | undefined;
  for (let elementIndex = 0; elementIndex < partQuery.elements.length; elementIndex += 1) {
    const element = partQuery.elements[elementIndex];
    if (element === undefined) continue;
    if (probe !== undefined) probe.elementsVisited += 1;
    if (!isElementOccurrenceVisible(view, partOccurrenceId, element)) continue;
    if (elementQuery === undefined) {
      elementQuery = {
        part,
        element,
        geometryByPrimitive: partQuery.geometryByPrimitive,
        transform: instance.transform,
        frustum: context.frustum,
        sectionPlane: view.presentation.sectionPlane,
        deformation: context.deformation,
        tolerance: context.tolerance,
        elementBounds: partQuery.elementBounds,
        elementIndex,
        points: context.points,
        boundsPlanes: localBoundsPlanes(
          instance.transform,
          context.frustum,
          view.presentation.sectionPlane,
        ),
      };
    } else {
      elementQuery.element = element;
      elementQuery.elementIndex = elementIndex;
    }
    if (probe !== undefined) probe.intersectionTests += 1;
    if (elementIntersectsBox(elementQuery)) {
      if (context.selection.append(element.id) && probe !== undefined) probe.groupsCreated += 1;
      if (probe !== undefined) probe.selectedIdentities += 1;
    }
  }
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
