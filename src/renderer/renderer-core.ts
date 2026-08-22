import type { Camera } from "../camera/camera";
import type { Vec3 } from "../math/vec3";
import type { Part, PartId } from "../geometry/part";
import { createInteractionState, type InteractionState } from "../interaction/interaction";
import type { BoxSelectionRect } from "../interaction/box-selection";
import type { InteractionGranularity, PickHit } from "../picking/types";
import type { PackedSceneRuntime } from "../scene-runtime/runtime";
import { RendererAttachment } from "./attachment";
import { prepareAddedAttachmentParts } from "./attachment/part-definitions";
import { destroyInstanceResources } from "./resources/draw-resources";
import { SectionCapController, sameSectionPlane } from "./section-cap-controller";
import type { ViewportBackground, WebGpuRenderer, WebGpuRendererOptions } from "./types";
import { validateDeformation } from "./frame/deformation";
import { syncResultColors } from "./resources/result-colors";
import { GpuDeviceLifecycle } from "./recovery";
import { writeBundleBackgroundColors } from "./frame/background";
import type { GpuCostSnapshot } from "./diagnostics/cost";
import type { SectionPlane } from "../math/section-plane";
import { syncOrientationGlyphs } from "./orientation-glyphs/orientation-glyph";
import { createEdgePickState, type EdgePickState } from "./edges/edge-picking";
import { buildRendererFrameOptions, type RendererFrameOptionsOwner } from "./frame/frame-options";
import { renderRendererFrame, type RendererFrameHost } from "./frame/render-frame";
import { drawCostSnapshot, materializedEdgePartIds } from "./diagnostics/renderer-diagnostics";
import { RendererPicking, type RendererPickingHost } from "./picking/renderer-picking";
import {
  createGpuTimestampRecorder,
  unavailableGpuTimestampSnapshot,
  type GpuTimestampRecorder,
  type GpuTimestampSnapshot,
} from "./diagnostics/timestamps";
import type { GpuRendererConstruction } from "./renderer-construction";
import { applyRendererPartRevision } from "./attachment/part-revision";
import type {
  PartRevisionResultState,
  RendererResultSnapshot,
} from "./attachment/part-revision-results";
import {
  commitRendererOccurrenceUpdate,
  discardRendererOccurrenceUpdate,
  prepareRendererOccurrenceUpdate,
  type PreparedRendererOccurrenceUpdate,
} from "./occurrence-revision/renderer-transaction";

/** The WebGPU renderer implementation; see `gpu-renderer.ts` for the API. */
export class GpuRenderer implements WebGpuRenderer, RendererFrameHost, RendererFrameOptionsOwner {
  public readonly context: GPUCanvasContext;
  public readonly format: GPUTextureFormat;
  public readonly depthFormat: GPUTextureFormat;
  public readonly lifecycle: GpuDeviceLifecycle;
  public pointSize: number;
  public nodeSize: number;
  public readonly originTriadEnabled: boolean;
  private background: ViewportBackground;
  public readonly attachment = new RendererAttachment();
  public parts = new Map<PartId, Part>();
  public sourceParts: ReadonlyMap<PartId, Part> | undefined;
  public lastCamera: Camera | undefined;
  public readonly edgePick: EdgePickState;
  public readonly picking: RendererPicking;
  public edgeDepthTest = true;
  private edgesVisible = false;
  private nodesVisible = false;
  public orbitPivot: Vec3 | undefined;
  public results: RendererResultSnapshot | undefined;
  public sectionPlane: SectionPlane | undefined;
  public interaction = createInteractionState();
  public readonly sectionCaps = new SectionCapController();
  public timestampRecorder: GpuTimestampRecorder | undefined;
  private readonly timestampQueriesRequested: boolean;
  public originTriadNominalScale = 1;
  public interactionNeedsRecoverySync = false;
  private destroyed = false;

  public constructor(
    public readonly canvas: HTMLCanvasElement,
    options: WebGpuRendererOptions,
    construction: GpuRendererConstruction,
  ) {
    this.context = construction.context;
    this.format = construction.format;
    this.depthFormat = construction.depthFormat;
    this.timestampQueriesRequested = construction.timestampQueriesRequested ?? false;
    this.timestampRecorder = construction.timestampRecorder;
    [this.pointSize, this.nodeSize] = [options.pointSizePixels ?? 8, options.nodeSizePixels ?? 6];
    this.originTriadEnabled = options.originTriad ?? true;
    this.edgePick = createEdgePickState(construction.validation);
    this.background = options.background ?? "studio";
    this.lifecycle = new GpuDeviceLifecycle({
      bundle: construction.bundle,
      context: construction.context,
      format: this.format,
      depthFormat: this.depthFormat,
      powerPreference: options.powerPreference,
      validation: construction.validation,
      ownsDevice: options.device === undefined,
      originTriad: options.originTriad ?? true,
      onLost: (info) => {
        if (!this.destroyed) options.onDeviceLost?.(info);
      },
    });
    this.picking = new RendererPicking(this satisfies RendererPickingHost);
    writeBundleBackgroundColors(this.lifecycle.bundle, this.background);
    this.resize();
  }

  public render(
    runtime: PackedSceneRuntime,
    camera: Camera,
    parts: ReadonlyMap<PartId, Part>,
    originTriadNominalScale = 1,
  ): void {
    this.ensureAlive();
    renderRendererFrame(this, runtime, camera, parts, originTriadNominalScale);
  }

  public resetScene(parts: ReadonlyMap<PartId, Part>): void {
    this.ensureAlive();
    syncResultColors(this.lifecycle.bundle.draw, undefined);
    this.sectionCaps.reset(this.lifecycle.bundle.draw);
    this.attachment.clear(this.lifecycle.bundle);
    this.attachment.prepareParts(parts, this.lifecycle.bundle);
    destroyInstanceResources(this.lifecycle.bundle.draw);
    this.parts = new Map();
    this.lastCamera = this.sourceParts = undefined;
    this.results = undefined;
    this.interaction = createInteractionState();
    this.picking.invalidate();
  }

  public setResultSnapshot(results: RendererResultSnapshot | undefined): void {
    this.ensureAlive();
    if (results?.deformation !== undefined) validateDeformation(results.deformation);
    const previous = this.results;
    const deformationChanged = previous?.deformation !== results?.deformation;
    const colorsChanged = previous?.colors !== results?.colors;
    const glyphsChanged = previous?.glyphs !== results?.glyphs;
    if (!deformationChanged && !colorsChanged && !glyphsChanged) return;
    if (deformationChanged) {
      this.picking.invalidate();
      this.sectionCaps.invalidate();
    }
    const runtime = this.attachment.runtime;
    const layout = this.attachment.layout;
    if (glyphsChanged && runtime !== undefined && layout !== undefined) {
      syncOrientationGlyphs(
        this.lifecycle.bundle.draw.orientationGlyphs,
        results?.glyphs,
        runtime,
        layout,
      );
    }
    if (colorsChanged) {
      this.sectionCaps.invalidate();
      if (runtime !== undefined && layout !== undefined)
        syncResultColors(this.lifecycle.bundle.draw, results?.colors, runtime, layout);
    }
    this.results = results;
  }

  public setSectionPlane(plane: SectionPlane | undefined): void {
    this.ensureAlive();
    if (sameSectionPlane(this.sectionPlane, plane)) return;
    this.sectionPlane = plane;
    this.sectionCaps.invalidate();
    this.picking.invalidate();
  }

  public syncInteraction(
    runtime: PackedSceneRuntime,
    interaction: InteractionState,
    changedInstanceIds?: readonly number[],
  ): void {
    this.ensureAlive();
    const instanceChanged =
      changedInstanceIds !== undefined && changedInstanceIds.length > 0
        ? this.attachment.updateInstances(
            runtime,
            interaction,
            changedInstanceIds,
            this.lifecycle.bundle,
          )
        : false;
    const emphasisChanged = this.attachment.updateElements(
      runtime,
      interaction,
      this.lifecycle.bundle,
      this.parts,
      changedInstanceIds,
    );
    this.interaction = interaction;
    if (instanceChanged) this.sectionCaps.invalidate();
    this.sectionCaps.syncInteraction(interaction, runtime, this.parts, this.lifecycle.bundle.draw);
    if (instanceChanged || emphasisChanged) this.picking.invalidate();
  }

  public syncInstanceTransforms(
    runtime: PackedSceneRuntime,
    interaction: InteractionState,
    changedInstanceIds: readonly number[],
  ): void {
    this.ensureAlive();
    this.interaction = interaction;
    const changed = this.attachment.updateInstances(
      runtime,
      interaction,
      changedInstanceIds,
      this.lifecycle.bundle,
    );
    if (changed) this.sectionCaps.invalidate();
    this.sectionCaps.syncInteraction(interaction, runtime, this.parts, this.lifecycle.bundle.draw);
    if (changed) this.picking.invalidate();
  }

  /** Completes all fallible placement allocations without changing live renderer state. */
  public prepareOccurrenceUpdate(
    options: Parameters<typeof prepareRendererOccurrenceUpdate>[1],
  ): PreparedRendererOccurrenceUpdate {
    this.ensureAlive();
    return prepareRendererOccurrenceUpdate(this, options);
  }

  /** Publishes a fully prepared placement transaction and invalidates picking once. */
  public commitOccurrenceUpdate(prepared: PreparedRendererOccurrenceUpdate): void {
    this.ensureAlive();
    commitRendererOccurrenceUpdate(this, prepared);
  }

  /** Releases all resources allocated by an uncommitted placement transaction. */
  public discardOccurrenceUpdate(prepared: PreparedRendererOccurrenceUpdate): void {
    discardRendererOccurrenceUpdate(this, prepared);
  }

  public preparePartAdditions(
    parts: ReadonlyMap<PartId, Part>,
    partIds: ReadonlySet<PartId>,
  ): void {
    this.ensureAlive();
    prepareAddedAttachmentParts(parts, partIds);
  }

  public updatePartRevisions(
    runtime: PackedSceneRuntime,
    interaction: InteractionState,
    parts: ReadonlyMap<PartId, Part>,
    partIds: ReadonlySet<PartId>,
    results?: PartRevisionResultState,
  ): void {
    this.ensureAlive();
    this.sourceParts = applyRendererPartRevision(
      this.attachment,
      this.parts,
      this.sourceParts,
      this.sectionCaps,
      {
        bundle: this.lifecycle.bundle,
        runtime,
        interaction,
        parts,
        partIds,
        results,
        plane: this.sectionPlane,
        deformation: results?.deformation ?? this.results?.deformation,
        resultColors: results?.colors ?? this.results?.colors,
      },
    );
    if (results !== undefined) {
      // The revision transaction already synchronized only changed result bindings.
      this.results = results;
    }
    this.interaction = interaction;
    this.picking.invalidate();
  }

  public setEdgeDepthTest(enabled: boolean): void {
    this.ensureAlive();
    this.edgeDepthTest = enabled;
  }

  public setEdgesVisible(enabled: boolean): void {
    this.ensureAlive();
    if (this.edgesVisible === enabled) return;
    this.edgesVisible = enabled;
    if (this.attachment.setOverlayVisibility(enabled, this.nodesVisible, this.lifecycle.bundle)) {
      this.picking.invalidate();
    }
  }

  public setNodesVisible(enabled: boolean): void {
    this.ensureAlive();
    if (this.nodesVisible === enabled) return;
    this.nodesVisible = enabled;
    if (this.attachment.setOverlayVisibility(this.edgesVisible, enabled, this.lifecycle.bundle)) {
      this.picking.invalidate();
    }
  }

  public setBackground(background: ViewportBackground): void {
    this.ensureAlive();
    if (this.background === background) return;
    writeBundleBackgroundColors(this.lifecycle.bundle, background);
    this.background = background;
  }

  public setPointSizePixels(size: number): void {
    this.ensureAlive();
    if (this.pointSize === size) return;
    this.pointSize = size;
    this.picking.invalidate();
  }

  public setNodeSizePixels(size: number): void {
    this.ensureAlive();
    if (this.nodeSize === size) return;
    this.nodeSize = size;
    this.picking.invalidate();
  }

  public setOrbitPivot(pivot: Vec3 | undefined): void {
    this.ensureAlive();
    this.orbitPivot = pivot;
  }

  public updateVisibility(runtime: PackedSceneRuntime, affectedPartIds: readonly PartId[]): void {
    this.ensureAlive();
    if (!this.attachment.updateVisibility(runtime, affectedPartIds, this.lifecycle.bundle)) return;
    this.sectionCaps.invalidate();
    this.picking.invalidate();
  }

  public async pick(x: number, y: number, granularity?: "edge"): Promise<PickHit | undefined> {
    this.ensureAlive();
    return this.picking.pick(x, y, granularity);
  }

  public async pickRegion(rect: BoxSelectionRect, granularity: InteractionGranularity) {
    this.ensureAlive();
    return this.picking.pickRegion(rect, granularity);
  }

  public async pickPoint(camera: Camera, x: number, y: number): Promise<Vec3 | undefined> {
    this.ensureAlive();
    return this.picking.pickPoint(camera, x, y);
  }

  public resize(width = this.canvas.clientWidth, height = this.canvas.clientHeight): void {
    this.canvas.width = Math.max(1, Math.floor(width * devicePixelRatio));
    this.canvas.height = Math.max(1, Math.floor(height * devicePixelRatio));
    this.context.configure({
      device: this.lifecycle.bundle.device,
      format: this.format,
      alphaMode: "opaque",
    });
    this.picking.resize();
  }

  public stats(): { readonly drawBatches: number } {
    this.ensureAlive();
    return { drawBatches: this.attachment.calls.length };
  }

  public costSnapshot(): GpuCostSnapshot {
    this.ensureAlive();
    return drawCostSnapshot(this.lifecycle.bundle.draw.cost);
  }

  public materializedEdgePartIds(): ReadonlySet<PartId> {
    this.ensureAlive();
    return materializedEdgePartIds(this.lifecycle.bundle.draw);
  }

  public timestampSnapshot(): GpuTimestampSnapshot {
    this.ensureAlive();
    return this.timestampRecorder?.snapshot() ?? unavailableGpuTimestampSnapshot();
  }

  public async drainTimestampSamples(): Promise<void> {
    this.ensureAlive();
    await this.timestampRecorder?.drain();
  }

  public destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.timestampRecorder?.destroy();
    this.timestampRecorder = undefined;
    this.lifecycle.destroy();
  }

  public get lost(): boolean {
    return this.lifecycle.lost;
  }

  public get device(): GPUDevice {
    return this.lifecycle.bundle.device;
  }

  public async recover(): Promise<void> {
    if (this.destroyed) throw new Error("WebGPU renderer has been destroyed");
    if (await this.lifecycle.recover()) {
      this.timestampRecorder?.destroy();
      this.timestampRecorder = createGpuTimestampRecorder(
        this.lifecycle.bundle.device,
        this.timestampQueriesRequested,
      );
      this.attachment.clear(this.lifecycle.bundle);
      this.interactionNeedsRecoverySync = true;
      this.sectionCaps.recover(this.parts, this.results?.colors);
      this.picking.resetAfterRecovery();
      writeBundleBackgroundColors(this.lifecycle.bundle, this.background);
    }
  }

  private readonly ensureAlive = (): undefined => (this.lifecycle.ensureUsable(), undefined);

  public frameOptions() {
    return buildRendererFrameOptions(this);
  }

  public ensureSectionCaps(runtime: PackedSceneRuntime): void {
    this.sectionCaps.sync({
      runtime,
      parts: this.parts,
      plane: this.sectionPlane,
      interaction: this.interaction,
      deformation: this.results?.deformation,
      resultColors: this.results?.colors,
      draw: this.lifecycle.bundle.draw,
    });
  }
}
