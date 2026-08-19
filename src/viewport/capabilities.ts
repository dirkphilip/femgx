import type { Camera } from "../camera/camera";
import type { BoxSelectionRect } from "../interaction/box-selection";
import type { InteractionState } from "../interaction/interaction";
import type { InteractionTarget, InteractionTargetFor } from "../interaction/target-types";
import type { ViewportBackground } from "../renderer/gpu-renderer";
import type { EdgePickHit, InteractionGranularity, PickHit } from "../picking/types";
import type { PartId } from "../geometry/part";
import type { AssemblyId, AssemblyOccurrenceId, PartOccurrenceId } from "../scene/types";
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
  return new ViewportInteractionCapability(options);
}

class ViewportInteractionCapability implements ViewportInteraction {
  constructor(private readonly options: InteractionCapabilityOptions) {}

  get state(): InteractionState {
    this.options.ensureAlive();
    return this.options.state();
  }
  set(interaction: InteractionState): void {
    this.options.ensureAlive();
    this.options.set(interaction);
  }
  pick(x: number, y: number, granularity: "edge"): Promise<EdgePickHit | undefined>;
  pick(x: number, y: number, granularity?: "edge"): Promise<PickHit | undefined>;
  pick(x: number, y: number, granularity?: "edge"): Promise<PickHit | undefined> {
    this.options.ensureAlive();
    return this.options.pick(x, y, granularity);
  }
  pickRegion(
    rect: BoxSelectionRect,
    granularity: "part",
  ): Promise<readonly InteractionTargetFor<"part">[]>;
  pickRegion(
    rect: BoxSelectionRect,
    granularity: "partOccurrence",
  ): Promise<readonly InteractionTargetFor<"partOccurrence">[]>;
  pickRegion(
    rect: BoxSelectionRect,
    granularity: "body",
  ): Promise<readonly InteractionTargetFor<"body">[]>;
  pickRegion(
    rect: BoxSelectionRect,
    granularity: "element",
  ): Promise<readonly InteractionTargetFor<"element">[]>;
  pickRegion(
    rect: BoxSelectionRect,
    granularity: "face",
  ): Promise<readonly InteractionTargetFor<"face">[]>;
  pickRegion(
    rect: BoxSelectionRect,
    granularity: "node",
  ): Promise<readonly InteractionTargetFor<"node">[]>;
  pickRegion(
    rect: BoxSelectionRect,
    granularity: "edge",
  ): Promise<readonly InteractionTargetFor<"edge">[]>;
  pickRegion(
    rect: BoxSelectionRect,
    granularity: InteractionGranularity,
  ): Promise<readonly InteractionTarget[]>;
  pickRegion(
    rect: BoxSelectionRect,
    granularity: InteractionGranularity,
  ): Promise<readonly InteractionTarget[]> {
    this.options.ensureAlive();
    return this.options.pickRegion(rect, granularity);
  }
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
    setPartOccurrence(partOccurrenceId: PartOccurrenceId, visible: boolean): void {
      owner.ensureAlive();
      controller.setPartOccurrence(partOccurrenceId, visible);
    },
    setPartOccurrences(partOccurrenceIds: Iterable<PartOccurrenceId>, visible: boolean): void {
      owner.ensureAlive();
      controller.setPartOccurrences(partOccurrenceIds, visible);
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
