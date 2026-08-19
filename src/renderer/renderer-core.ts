import type { Camera } from "../camera/camera";
import type { Vec3 } from "../math/vec3";
import type { Part, PartId } from "../geometry/part";
import { createInteractionState, type InteractionState } from "../interaction/interaction";
import type { BoxSelectionRect } from "../interaction/box-selection";
import type { InteractionTarget } from "../interaction/target-types";
import type { InteractionGranularity, PickHit } from "../picking/types";
import type { DeformationState } from "../results/deform";
import type { ResultColorMap } from "../results/colors";
import type { PackedSceneRuntime } from "../scene-runtime/runtime";
import { RendererAttachment } from "./attachment";
import { destroyInstanceResources } from "./resources/draw-resources";
import { SectionCapController, sameSectionPlane } from "./section-cap-controller";
import type { ViewportBackground, WebGpuRenderer, WebGpuRendererOptions } from "./types";
import { syncDeformations, validateDeformation } from "./frame/deformation";
import { syncResultColors } from "./resources/result-colors";
import { encodeVisibleFrame } from "./frame/frame";
import { GpuDeviceLifecycle } from "./recovery";
import { writeBackgroundColors } from "./frame/background";
import type { GpuCostSnapshot } from "./diagnostics/cost";
import type { SectionPlane } from "../math/section-plane";
import {
  syncOrientationGlyphs,
  type OrientationGlyphState,
} from "./orientation-glyphs/orientation-glyph";
import { createEdgePickState, type EdgePickState } from "./edges/edge-picking";
import { buildFrameOptions } from "./frame/frame-options";
import { drawCostSnapshot, materializedEdgePartIds } from "./diagnostics/renderer-diagnostics";
import { RendererPicking } from "./renderer-picking";
import {
  createGpuTimestampRecorder,
  unavailableGpuTimestampSnapshot,
  type GpuTimestampRecorder,
  type GpuTimestampSnapshot,
} from "./diagnostics/timestamps";
import type { GpuRendererConstruction } from "./renderer-construction";

/** The WebGPU renderer implementation; see `gpu-renderer.ts` for the API. */
export class GpuRenderer implements WebGpuRenderer {
  private readonly context: GPUCanvasContext;
  private readonly format: GPUTextureFormat;
  private readonly depthFormat: GPUTextureFormat;
  private readonly lifecycle: GpuDeviceLifecycle;
  private pointSize: number;
  private nodeSize: number;
  private readonly originTriadEnabled: boolean;
  private background: ViewportBackground;
  private readonly attachment = new RendererAttachment();
  private parts = new Map<PartId, Part>();
  private sourceParts: ReadonlyMap<PartId, Part> | undefined;
  private lastCamera: Camera | undefined;
  private readonly edgePick: EdgePickState;
  private readonly picking: RendererPicking;
  private edgeDepthTest = true;
  private orbitPivot: Vec3 | undefined;
  private deformation: DeformationState | undefined;
  private resultColors: ResultColorMap | undefined;
  private sectionPlane: SectionPlane | undefined;
  private interaction = createInteractionState();
  private readonly sectionCaps = new SectionCapController();
  private timestampRecorder: GpuTimestampRecorder | undefined;
  private readonly timestampQueriesRequested: boolean;
  private orientationGlyphs: OrientationGlyphState | undefined;
  private originTriadNominalScale = 1;
  private destroyed = false;

  public constructor(
    private readonly canvas: HTMLCanvasElement,
    options: WebGpuRendererOptions,
    construction: GpuRendererConstruction,
  ) {
    this.context = construction.context;
    this.format = construction.format;
    this.depthFormat = construction.depthFormat;
    this.timestampQueriesRequested = construction.timestampQueriesRequested ?? false;
    this.timestampRecorder = construction.timestampRecorder;
    this.pointSize = options.pointSizePixels ?? 8;
    this.nodeSize = options.nodeSizePixels ?? 6;
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
    this.picking = new RendererPicking({
      canvas: this.canvas,
      lifecycle: this.lifecycle,
      attachment: this.attachment,
      edgePick: this.edgePick,
      sectionCaps: this.sectionCaps,
      parts: () => this.parts,
      lastCamera: () => this.lastCamera,
      setLastCamera: (camera) => {
        this.lastCamera = camera;
      },
      deformation: () => this.deformation,
      ensureSectionCaps: (runtime) => {
        this.ensureSectionCaps(runtime);
      },
      frameOptions: () => this.frameOptions(),
    });
    writeBackgroundColors(
      this.lifecycle.bundle.device,
      this.lifecycle.bundle.resources.background,
      this.background,
    );
    this.resize();
  }

  public render(
    runtime: PackedSceneRuntime,
    camera: Camera,
    parts: ReadonlyMap<PartId, Part>,
    originTriadNominalScale = 1,
  ): void {
    this.ensureAlive();
    this.lifecycle.bundle.draw.cost.reset();
    this.originTriadNominalScale = originTriadNominalScale;
    const partsChanged = this.sourceParts !== parts;
    const cameraChanged = this.lastCamera !== camera;
    this.lastCamera = camera;
    if (partsChanged) {
      this.sourceParts = parts;
      this.parts = new Map(parts);
      this.attachment.prepareParts(this.parts, this.lifecycle.bundle);
      this.sectionCaps.invalidate();
    }
    const attachmentChanged = this.attachment.attach(runtime, this.lifecycle.bundle);
    if (attachmentChanged) this.sectionCaps.invalidate();
    if (attachmentChanged || partsChanged) {
      this.attachment.updateNodeOrders(this.parts, this.lifecycle.bundle);
    }
    const layout = this.attachment.layout;
    if (layout === undefined) throw new Error("Renderer attachment layout is unavailable");
    syncDeformations(this.lifecycle.bundle.draw, this.deformation, runtime, layout);
    this.ensureSectionCaps(runtime);
    syncResultColors(this.lifecycle.bundle.draw, this.sectionCaps.resultColors, runtime, layout);
    const glyphs = this.lifecycle.bundle.draw.orientationGlyphs;
    syncOrientationGlyphs(glyphs, this.orientationGlyphs, runtime, layout);
    if (partsChanged || cameraChanged || attachmentChanged) this.picking.invalidate();
    encodeVisibleFrame(camera, this.sectionCaps.parts, this.frameOptions());
  }

  public resetScene(parts: ReadonlyMap<PartId, Part>): void {
    this.ensureAlive();
    syncResultColors(this.lifecycle.bundle.draw, undefined);
    this.sectionCaps.reset(this.lifecycle.bundle.draw);
    this.attachment.clear(this.lifecycle.bundle);
    this.attachment.prepareParts(parts, this.lifecycle.bundle);
    destroyInstanceResources(this.lifecycle.bundle.draw);
    this.parts = new Map();
    this.sourceParts = undefined;
    this.lastCamera = undefined;
    this.deformation = undefined;
    this.resultColors = undefined;
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

  /** Installs renderer-owned elemental orientation records without public API leakage. */
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
    const interactionChanged = this.interaction !== interaction;
    this.interaction = interaction;
    const changed = this.attachment.updateInstances(
      runtime,
      interaction,
      changedInstanceIds,
      this.lifecycle.bundle,
    );
    if (interactionChanged || changed) this.sectionCaps.invalidate();
    if (changed) {
      this.picking.invalidate();
    }
  }

  public updateElements(
    runtime: PackedSceneRuntime,
    interaction: InteractionState,
    changedInstanceIds?: readonly number[],
  ): void {
    this.ensureAlive();
    const interactionChanged = this.interaction !== interaction;
    this.interaction = interaction;
    const changed = this.attachment.updateElements(
      runtime,
      interaction,
      this.lifecycle.bundle,
      this.parts,
      changedInstanceIds,
    );
    if (interactionChanged || changed) this.sectionCaps.invalidate();
    if (changed) {
      this.picking.invalidate();
    }
  }

  public setEdgeDepthTest(enabled: boolean): void {
    this.ensureAlive();
    this.edgeDepthTest = enabled;
  }

  public setBackground(background: ViewportBackground): void {
    this.ensureAlive();
    if (this.background === background) return;
    const { device, resources } = this.lifecycle.bundle;
    writeBackgroundColors(device, resources.background, background);
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
    const changed = this.attachment.updateVisibility(
      runtime,
      affectedPartIds,
      this.lifecycle.bundle,
    );
    if (changed) {
      this.sectionCaps.invalidate();
      this.picking.invalidate();
    }
  }

  public async pick(x: number, y: number, granularity?: "edge"): Promise<PickHit | undefined> {
    this.ensureAlive();
    return this.picking.pick(x, y, granularity);
  }

  public async pickRegion(
    rect: BoxSelectionRect,
    granularity: InteractionGranularity,
  ): Promise<readonly InteractionTarget[]> {
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
      this.sectionCaps.recover(this.parts, this.resultColors);
      this.picking.resetAfterRecovery();
      writeBackgroundColors(
        this.lifecycle.bundle.device,
        this.lifecycle.bundle.resources.background,
        this.background,
      );
    }
  }

  private ensureAlive(): void {
    if (this.destroyed) throw new Error("WebGPU renderer has been destroyed");
    this.lifecycle.ensureUsable();
  }

  private frameOptions() {
    const caps = this.sectionCaps.currentFrame;
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
      capCalls: caps?.calls,
      transparentCapCalls: caps?.transparentCalls,
      allCapCalls: caps?.allCalls,
      orbitPivot: this.orbitPivot,
      originTriadEnabled: this.originTriadEnabled,
      originTriadNominalScale: this.originTriadNominalScale,
      timestampRecorder: this.timestampRecorder,
    });
  }

  private ensureSectionCaps(runtime: PackedSceneRuntime): void {
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
