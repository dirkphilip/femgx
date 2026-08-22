import type { Camera } from "../camera/camera";
import type { Vec3 } from "../math/vec3";
import type { Part, PartId } from "../geometry/part";
import { createInteractionState, type InteractionState } from "../interaction/interaction";
import type { BoxSelectionRect } from "../interaction/box-selection";
import type { InteractionGranularity, PickHit } from "../picking/types";
import type { DeformationState } from "../results/deform";
import type { ResultColorMap } from "../results/colors";
import type { PackedSceneRuntime } from "../scene-runtime/runtime";
import { RendererAttachment } from "./attachment";
import { destroyInstanceResources } from "./resources/draw-resources";
import { SectionCapController, sameSectionPlane } from "./section-cap-controller";
import type { ViewportBackground, WebGpuRenderer, WebGpuRendererOptions } from "./types";
import { validateDeformation } from "./frame/deformation";
import { syncResultColors } from "./resources/result-colors";
import { GpuDeviceLifecycle } from "./recovery";
import { writeBundleBackgroundColors } from "./frame/background";
import type { GpuCostSnapshot } from "./diagnostics/cost";
import type { SectionPlane } from "../math/section-plane";
import {
  syncOrientationGlyphs,
  type OrientationGlyphState,
} from "./orientation-glyphs/orientation-glyph";
import { createEdgePickState, type EdgePickState } from "./edges/edge-picking";
import { buildFrameOptions } from "./frame/frame-options";
import { renderRendererFrame, type RendererFrameHost } from "./frame/render-frame";
import { drawCostSnapshot, materializedEdgePartIds } from "./diagnostics/renderer-diagnostics";
import { createRendererPicking, type RendererPicking } from "./picking/renderer-picking";
import {
  createGpuTimestampRecorder,
  unavailableGpuTimestampSnapshot,
  type GpuTimestampRecorder,
  type GpuTimestampSnapshot,
} from "./diagnostics/timestamps";
import type { GpuRendererConstruction } from "./renderer-construction";
import { applyRendererPartRevision } from "./attachment/part-revision";
import type { PartRevisionResultState } from "./attachment/part-revision-results";
import {
  commitRendererOccurrenceUpdate,
  discardRendererOccurrenceUpdate,
  prepareRendererOccurrenceUpdate,
  type PreparedRendererOccurrenceUpdate,
} from "./occurrence-revision/renderer-transaction";

/** The WebGPU renderer implementation; see `gpu-renderer.ts` for the API. */
export class GpuRenderer implements WebGpuRenderer, RendererFrameHost {
  private readonly context: GPUCanvasContext;
  private readonly format: GPUTextureFormat;
  private readonly depthFormat: GPUTextureFormat;
  public readonly lifecycle: GpuDeviceLifecycle;
  private pointSize: number;
  private nodeSize: number;
  private readonly originTriadEnabled: boolean;
  private background: ViewportBackground;
  public readonly attachment = new RendererAttachment();
  public parts = new Map<PartId, Part>();
  public sourceParts: ReadonlyMap<PartId, Part> | undefined;
  public lastCamera: Camera | undefined;
  public readonly edgePick: EdgePickState;
  public readonly picking: RendererPicking;
  private edgeDepthTest = true;
  private edgesVisible: boolean | undefined;
  private nodesVisible: boolean | undefined;
  private orbitPivot: Vec3 | undefined;
  public deformation: DeformationState | undefined;
  public resultColors: ResultColorMap | undefined;
  public sectionPlane: SectionPlane | undefined;
  public interaction = createInteractionState();
  public readonly sectionCaps = new SectionCapController();
  private timestampRecorder: GpuTimestampRecorder | undefined;
  private readonly timestampQueriesRequested: boolean;
  public orientationGlyphs: OrientationGlyphState | undefined;
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
    this.picking = createRendererPicking(this);
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
    this.resultColors = this.deformation = undefined;
    this.interaction = createInteractionState();
    this.orientationGlyphs = undefined;
    this.picking.invalidate();
  }

  public setDeformation(deformation: DeformationState | undefined): void {
    this.ensureAlive();
    if (deformation !== undefined) validateDeformation(deformation);
    if (this.deformation !== deformation) {
      this.picking.invalidate();
      this.sectionCaps.invalidate();
    }
    this.deformation = deformation;
  }

  public setResultColors(colors: ResultColorMap | undefined): void {
    this.ensureAlive();
    if (this.resultColors === colors) return;
    this.resultColors = colors;
    this.sectionCaps.invalidate();
    const runtime = this.attachment.runtime;
    const layout = this.attachment.layout;
    if (runtime !== undefined && layout !== undefined)
      syncResultColors(this.lifecycle.bundle.draw, colors, runtime, layout);
  }

  public setOrientationGlyphs(state: OrientationGlyphState | undefined): void {
    this.ensureAlive();
    if (this.attachment.runtime !== undefined && this.attachment.layout !== undefined) {
      syncOrientationGlyphs(
        this.lifecycle.bundle.draw.orientationGlyphs,
        state,
        this.attachment.runtime,
        this.attachment.layout,
      );
    }
    this.orientationGlyphs = state;
  }

  public setSectionPlane(plane: SectionPlane | undefined): void {
    this.ensureAlive();
    if (sameSectionPlane(this.sectionPlane, plane)) return;
    this.sectionPlane = plane;
    this.sectionCaps.invalidate();
    this.picking.invalidate();
  }

  public updateInstances(
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
        deformation: results?.deformation ?? this.deformation,
        resultColors: results?.colors ?? this.resultColors,
      },
    );
    if (results !== undefined) {
      this.deformation = results.deformation;
      this.resultColors = results.colors;
      // The revision transaction already synchronized only changed glyph bindings.
      this.orientationGlyphs = results.glyphs;
    }
    this.interaction = interaction;
    this.picking.invalidate();
  }

  public updateElements(
    runtime: PackedSceneRuntime,
    interaction: InteractionState,
    changedInstanceIds?: readonly number[],
  ): void {
    this.ensureAlive();
    this.interaction = interaction;
    const changed = this.attachment.updateElements(
      runtime,
      interaction,
      this.lifecycle.bundle,
      this.parts,
      changedInstanceIds,
    );
    this.sectionCaps.syncInteraction(interaction, runtime, this.parts, this.lifecycle.bundle.draw);
    if (changed) this.picking.invalidate();
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
      this.sectionCaps.recover(this.parts, this.resultColors);
      this.picking.resetAfterRecovery();
      writeBundleBackgroundColors(this.lifecycle.bundle, this.background);
    }
  }

  private readonly ensureAlive = (): undefined => (this.lifecycle.ensureUsable(), undefined);

  public frameOptions() {
    return buildFrameOptions({
      canvas: this.canvas,
      context: this.context,
      bundle: this.lifecycle.bundle,
      attachment: this.attachment,
      colorFormat: this.format,
      depthFormat: this.depthFormat,
      edgeDepthTest: this.edgeDepthTest,
      pointSize: this.pointSize,
      nodeSize: this.nodeSize,
      deformation: this.deformation,
      sectionPlane: this.sectionPlane,
      resultColors: this.sectionCaps.resultColors,
      sectionCaps: this.sectionCaps,
      orbitPivot: this.orbitPivot,
      originTriadEnabled: this.originTriadEnabled,
      originTriadNominalScale: this.originTriadNominalScale,
      timestampRecorder: this.timestampRecorder,
    });
  }

  public ensureSectionCaps(runtime: PackedSceneRuntime): void {
    this.sectionCaps.sync({
      runtime,
      parts: this.parts,
      plane: this.sectionPlane,
      interaction: this.interaction,
      deformation: this.deformation,
      resultColors: this.resultColors,
      draw: this.lifecycle.bundle.draw,
    });
  }
}
