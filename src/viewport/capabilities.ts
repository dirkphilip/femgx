import type { Camera } from "../camera/camera";
import type { BoxSelectionRect } from "../interaction/box-selection";
import type { InteractionState } from "../interaction/interaction";
import type { InteractionTarget } from "../interaction/target-types";
import type { ViewportBackground } from "../renderer/gpu-renderer";
import type { InteractionGranularity, PickHit } from "../picking/types";
import type { PartId } from "../geometry/part";
import type { AssemblyId, AssemblyOccurrenceId, InstanceId } from "../scene/types";
import type { ViewportVisibilityController } from "./visibility-controller";
import type {
  CameraTransitionOptions,
  ViewportInteraction,
  ViewportPresentation,
  ViewportResults,
  ViewportView,
  ViewportVisibility,
} from "./types";
import type { ViewportResultsConfig, ViewportResultsState } from "./results";
import type { SectionPlane } from "../math/section-plane";

interface CapabilityOwner {
  readonly ensureAlive: () => void;
}

interface ViewCapabilityOptions extends CapabilityOwner {
  readonly camera: () => Camera;
  readonly setCamera: (camera: Camera, options?: CameraTransitionOptions) => void;
  readonly fit: (options?: CameraTransitionOptions) => void;
  readonly fitSelection: (options?: CameraTransitionOptions) => void;
}

function createViewportViewCapability(options: ViewCapabilityOptions): ViewportView {
  return {
    get camera(): Camera {
      options.ensureAlive();
      return options.camera();
    },
    setCamera(camera, transitionOptions): void {
      options.ensureAlive();
      options.setCamera(camera, transitionOptions);
    },
    fit(transitionOptions): void {
      options.ensureAlive();
      options.fit(transitionOptions);
    },
    fitSelection(transitionOptions): void {
      options.ensureAlive();
      options.fitSelection(transitionOptions);
    },
  };
}

interface InteractionCapabilityOptions extends CapabilityOwner {
  readonly state: () => InteractionState;
  readonly set: (interaction: InteractionState) => void;
  readonly pick: (x: number, y: number, granularity?: "edge") => Promise<PickHit | undefined>;
  readonly pickRegion: (
    rect: BoxSelectionRect,
    granularity: InteractionGranularity,
  ) => Promise<readonly InteractionTarget[]>;
}

function createViewportInteractionCapability(
  options: InteractionCapabilityOptions,
): ViewportInteraction {
  return {
    get state(): InteractionState {
      options.ensureAlive();
      return options.state();
    },
    set(interaction): void {
      options.ensureAlive();
      options.set(interaction);
    },
    pick(x, y, granularity): Promise<PickHit | undefined> {
      options.ensureAlive();
      return options.pick(x, y, granularity);
    },
    pickRegion(rect, granularity): Promise<readonly InteractionTarget[]> {
      options.ensureAlive();
      return options.pickRegion(rect, granularity);
    },
  };
}

function createViewportVisibilityCapability(
  owner: CapabilityOwner,
  controller: ViewportVisibilityController,
): ViewportVisibility {
  return {
    setPart(partId: PartId, visible: boolean): void {
      owner.ensureAlive();
      controller.setPart(partId, visible);
    },
    setAssemblyOccurrence(occurrenceId: AssemblyOccurrenceId, visible: boolean): void {
      owner.ensureAlive();
      controller.setAssemblyOccurrence(occurrenceId, visible);
    },
    setAssembly(assemblyId: AssemblyId, visible: boolean): void {
      owner.ensureAlive();
      controller.setAssembly(assemblyId, visible);
    },
    setInstance(instanceId: InstanceId, visible: boolean): void {
      owner.ensureAlive();
      controller.setInstance(instanceId, visible);
    },
  };
}

interface ResultsCapabilityOptions extends CapabilityOwner {
  readonly resultsState: () => ViewportResultsState | undefined;
  readonly setResults: (results: ViewportResultsConfig) => void;
  readonly clearResults: () => void;
}

function createViewportResultsCapability(options: ResultsCapabilityOptions): ViewportResults {
  return {
    get state(): ViewportResultsState | undefined {
      options.ensureAlive();
      return options.resultsState();
    },
    set(results): void {
      options.ensureAlive();
      options.setResults(results);
    },
    clear(): void {
      options.ensureAlive();
      options.clearResults();
    },
  };
}

interface PresentationCapabilityOptions extends CapabilityOwner {
  readonly sectionPlane: () => SectionPlane | undefined;
  readonly setSectionPlane: (plane: SectionPlane) => void;
  readonly clearSectionPlane: () => void;
  readonly setBackground: (background: ViewportBackground) => void;
  readonly setPointSizePixels: (size: number) => void;
  readonly setNodeSizePixels: (size: number) => void;
  readonly setEdgeDepthTest: (enabled: boolean) => void;
}

function createViewportPresentationCapability(
  options: PresentationCapabilityOptions,
): ViewportPresentation {
  return {
    get sectionPlane(): SectionPlane | undefined {
      options.ensureAlive();
      return options.sectionPlane();
    },
    setSectionPlane(plane): void {
      options.ensureAlive();
      options.setSectionPlane(plane);
    },
    clearSectionPlane(): void {
      options.ensureAlive();
      options.clearSectionPlane();
    },
    setBackground(background): void {
      options.ensureAlive();
      options.setBackground(background);
    },
    setPointSizePixels(size): void {
      options.ensureAlive();
      options.setPointSizePixels(size);
    },
    setNodeSizePixels(size): void {
      options.ensureAlive();
      options.setNodeSizePixels(size);
    },
    setEdgeDepthTest(enabled): void {
      options.ensureAlive();
      options.setEdgeDepthTest(enabled);
    },
  };
}

interface ViewportCapabilityOptions
  extends
    ViewCapabilityOptions,
    InteractionCapabilityOptions,
    ResultsCapabilityOptions,
    PresentationCapabilityOptions {
  readonly visibilityController: ViewportVisibilityController;
}

interface ViewportCapabilitySet {
  readonly view: ViewportView;
  readonly interaction: ViewportInteraction;
  readonly visibility: ViewportVisibility;
  readonly results: ViewportResults;
  readonly presentation: ViewportPresentation;
}

/** Creates the stable capability facades owned by one viewport lifetime. */
export function createViewportCapabilities(
  options: ViewportCapabilityOptions,
): ViewportCapabilitySet {
  const owner: CapabilityOwner = { ensureAlive: options.ensureAlive };
  return {
    view: createViewportViewCapability(options),
    interaction: createViewportInteractionCapability(options),
    visibility: createViewportVisibilityCapability(owner, options.visibilityController),
    results: createViewportResultsCapability(options),
    presentation: createViewportPresentationCapability(options),
  };
}
