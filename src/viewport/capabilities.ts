import type { Camera } from "../camera/camera";
import type { CameraRef } from "../camera/controls";
import type { BoxSelectionRect } from "../interaction/box-selection";
import type { InteractionState } from "../interaction/interaction";
import type { InteractionTarget, InteractionTargetFor } from "../interaction/target-types";
import type { ElementRegionSelection } from "../interaction/element-region-selection";
import type { ViewportBackground, WebGpuRenderer } from "../renderer/gpu-renderer";
import type { EdgePickHit, InteractionGranularity, PickHit } from "../picking/types";
import type { SectionPlane } from "../math/section-plane";
import type { CameraFocusController } from "./camera-focus";
import type { ViewportSceneController } from "./scene-controller";
import type { ViewportVisibilityController } from "./visibility-controller";
import type { ViewportLifecycleBoundary } from "./core/lifecycle-boundary";
import { assertPixelSize, assertViewportBackground } from "./dom";
import { normalizeSectionPlane } from "../math/section-plane";
import type {
  CameraTransitionOptions,
  ViewportInteraction,
  ViewportPresentation,
  ViewportResults,
  ViewportView,
} from "./types";
import type { ViewportResultsConfig } from "./results";

class ViewportViewCapability implements ViewportView {
  constructor(
    private readonly cameraRef: CameraRef,
    private readonly cameraFocus: CameraFocusController,
    private readonly lifecycle: ViewportLifecycleBoundary,
  ) {}

  get camera(): Camera {
    this.lifecycle.ensureAlive();
    return this.cameraRef.camera;
  }

  setCamera(camera: Camera, transitionOptions?: CameraTransitionOptions): void {
    this.lifecycle.ensureAlive();
    this.cameraFocus.setCamera(camera, transitionOptions);
  }

  fit(transitionOptions?: CameraTransitionOptions): void {
    this.lifecycle.ensureAlive();
    this.cameraFocus.fitView(transitionOptions, true);
  }

  fitSelection(transitionOptions?: CameraTransitionOptions): void {
    this.lifecycle.ensureAlive();
    this.cameraFocus.fitSelection(transitionOptions);
  }
}

class ViewportInteractionCapability implements ViewportInteraction {
  constructor(
    private readonly sceneController: ViewportSceneController,
    private readonly renderer: WebGpuRenderer,
    private readonly lifecycle: ViewportLifecycleBoundary,
  ) {}

  get state(): InteractionState {
    this.lifecycle.ensureAlive();
    return this.sceneController.interaction;
  }

  set(interaction: InteractionState): void {
    this.lifecycle.ensureAlive();
    this.sceneController.setInteraction(interaction);
    this.lifecycle.invalidate();
  }

  pick(x: number, y: number, granularity: "edge"): Promise<EdgePickHit | undefined>;
  pick(x: number, y: number, granularity?: "edge"): Promise<PickHit | undefined>;
  pick(x: number, y: number, granularity?: "edge"): Promise<PickHit | undefined> {
    this.lifecycle.ensureAlive();
    return this.renderer.pick(x, y, granularity);
  }

  pickRegion(
    rect: BoxSelectionRect,
    granularity: "assembly",
  ): Promise<readonly InteractionTargetFor<"assembly">[]>;
  pickRegion(
    rect: BoxSelectionRect,
    granularity: "assemblyOccurrence",
  ): Promise<readonly InteractionTargetFor<"assemblyOccurrence">[]>;
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
  pickRegion(rect: BoxSelectionRect, granularity: "element"): Promise<ElementRegionSelection>;
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
  ): Promise<ElementRegionSelection | readonly InteractionTarget[]>;
  pickRegion(
    rect: BoxSelectionRect,
    granularity: InteractionGranularity,
  ): Promise<ElementRegionSelection | readonly InteractionTarget[]> {
    this.lifecycle.ensureAlive();
    return this.renderer.pickRegion(rect, granularity);
  }
}

class ViewportResultsCapability implements ViewportResults {
  constructor(
    private readonly sceneController: ViewportSceneController,
    private readonly lifecycle: ViewportLifecycleBoundary,
  ) {}

  get state() {
    this.lifecycle.ensureAlive();
    return this.sceneController.results;
  }

  set(results: ViewportResultsConfig): void {
    this.lifecycle.ensureAlive();
    this.sceneController.setResults(results);
    this.lifecycle.invalidate();
  }

  clear(): void {
    this.lifecycle.ensureAlive();
    this.sceneController.clearResults();
    this.lifecycle.invalidate();
  }
}

interface PresentationState {
  readonly background: ViewportBackground;
  readonly pointSizePixels: number;
  readonly nodeSizePixels: number;
}

class ViewportPresentationCapability implements ViewportPresentation {
  private currentSectionPlane: SectionPlane | undefined;
  private background: ViewportBackground;
  private pointSizePixels: number;
  private nodeSizePixels: number;

  constructor(
    private readonly renderer: WebGpuRenderer,
    private readonly lifecycle: ViewportLifecycleBoundary,
    state: PresentationState,
  ) {
    this.background = state.background;
    this.pointSizePixels = state.pointSizePixels;
    this.nodeSizePixels = state.nodeSizePixels;
  }

  get sectionPlane(): SectionPlane | undefined {
    this.lifecycle.ensureAlive();
    return this.currentSectionPlane;
  }

  setSectionPlane(plane: SectionPlane): void {
    this.lifecycle.ensureAlive();
    const normalized = normalizeSectionPlane(plane);
    this.renderer.setSectionPlane(normalized);
    this.currentSectionPlane = normalized;
    this.lifecycle.invalidate();
  }

  clearSectionPlane(): void {
    this.lifecycle.ensureAlive();
    if (this.currentSectionPlane === undefined) return;
    this.renderer.setSectionPlane(undefined);
    this.currentSectionPlane = undefined;
    this.lifecycle.invalidate();
  }

  setBackground(background: ViewportBackground): void {
    this.lifecycle.ensureAlive();
    assertViewportBackground(background);
    if (this.background === background) return;
    this.renderer.setBackground(background);
    this.background = background;
    this.lifecycle.invalidate();
  }

  setPointSizePixels(size: number): void {
    this.lifecycle.ensureAlive();
    assertPixelSize("pointSizePixels", size);
    if (this.pointSizePixels === size) return;
    this.renderer.setPointSizePixels(size);
    this.pointSizePixels = size;
    this.lifecycle.invalidate();
  }

  setNodeSizePixels(size: number): void {
    this.lifecycle.ensureAlive();
    assertPixelSize("nodeSizePixels", size);
    if (this.nodeSizePixels === size) return;
    this.renderer.setNodeSizePixels(size);
    this.nodeSizePixels = size;
    this.lifecycle.invalidate();
  }

  setEdgeDepthTest(enabled: boolean): void {
    this.lifecycle.ensureAlive();
    this.renderer.setEdgeDepthTest(enabled);
    this.lifecycle.invalidate();
  }

  setEdgesVisible(enabled: boolean): void {
    this.lifecycle.ensureAlive();
    this.renderer.setEdgesVisible(enabled);
    this.lifecycle.invalidate();
  }

  setNodesVisible(enabled: boolean): void {
    this.lifecycle.ensureAlive();
    this.renderer.setNodesVisible(enabled);
    this.lifecycle.invalidate();
  }
}

interface ViewportCapabilityOptions {
  readonly cameraRef: CameraRef;
  readonly cameraFocus: CameraFocusController;
  readonly sceneController: ViewportSceneController;
  readonly renderer: WebGpuRenderer;
  readonly lifecycle: ViewportLifecycleBoundary;
  readonly visibilityController: ViewportVisibilityController;
  readonly presentation: PresentationState;
}

interface ViewportCapabilitySet {
  readonly view: ViewportViewCapability;
  readonly interaction: ViewportInteractionCapability;
  readonly visibility: ViewportVisibilityController;
  readonly results: ViewportResultsCapability;
  readonly presentation: ViewportPresentationCapability;
}

/** Creates the stable capability owners for one viewport lifetime. */
export function createViewportCapabilities(
  options: ViewportCapabilityOptions,
): ViewportCapabilitySet {
  return {
    view: new ViewportViewCapability(options.cameraRef, options.cameraFocus, options.lifecycle),
    interaction: new ViewportInteractionCapability(
      options.sceneController,
      options.renderer,
      options.lifecycle,
    ),
    visibility: options.visibilityController,
    results: new ViewportResultsCapability(options.sceneController, options.lifecycle),
    presentation: new ViewportPresentationCapability(
      options.renderer,
      options.lifecycle,
      options.presentation,
    ),
  };
}
