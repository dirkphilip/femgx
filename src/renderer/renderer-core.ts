import type { Camera } from "../camera/camera";
import type { Vec3 } from "../math/vec3";
import type { Part, PartId } from "../geometry/part";
import type { InteractionState } from "../interaction/interaction";
import type { BoxSelectionRect } from "../interaction/box-selection";
import type { InteractionTarget } from "../interaction/target-types";
import type { InteractionGranularity, PickHit } from "../picking/types";
import type { DeformationState } from "../results/deform";
import type { PackedSceneRuntime } from "../scene-runtime/runtime";
import { RendererAttachment } from "./attachment";
import { destroyInstanceResources } from "./resources/draw-resources";
import type { ViewportBackground, WebGpuRenderer, WebGpuRendererOptions } from "./types";
import { syncDeformations, validateDeformation } from "./frame/deformation";
import { syncResultColors } from "./resources/result-colors";
import { encodePickSnapshot, encodeVisibleFrame } from "./frame/frame";
import { pickHitFromPixel, resetPickTargets } from "./picking/pick";
import { pickTargetsFromRegion } from "./picking/region";
import { displayedPointFromPixel } from "./picking/point";
import { GpuDeviceLifecycle, type GpuBundle } from "./recovery";
import { writeBackgroundColors } from "./frame/background";
import type { GpuValidationOptions } from "./diagnostics/validation";
import type { GpuCostSnapshot } from "./diagnostics/cost";
import type { SectionPlane } from "../math/section-plane";
import {
  syncOrientationGlyphs,
  type OrientationGlyphState,
} from "./orientation-glyphs/orientation-glyph";
import {
  createEdgePickContext,
  createEdgePickState,
  invalidateEdgePickState,
  pickEdgePixel,
  pickEdgeRegion,
  type EdgePickState,
} from "./edges/edge-picking";
import { buildFrameOptions } from "./frame/frame-options";
import { drawCostSnapshot, materializedEdgePartIds } from "./diagnostics/renderer-diagnostics";

export interface GpuRendererConstruction {
  readonly bundle: GpuBundle;
  readonly context: GPUCanvasContext;
  readonly format: GPUTextureFormat;
  readonly depthFormat: GPUTextureFormat;
  readonly validation: GpuValidationOptions | undefined;
}

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
  private pickSnapshotValid = false;
  private readonly edgePick: EdgePickState;
  private edgeDepthTest = true;
  private orbitPivot: Vec3 | undefined;
  private deformation: DeformationState | undefined;
  private resultColors: ReadonlyMap<PartId, Float32Array> | undefined;
  private sectionPlane: SectionPlane | undefined;
  private orientationGlyphs: OrientationGlyphState | undefined;
  private originTriadNominalScale = 1;
  private nodeOrdersDirty = true;
  private destroyed = false;

  public constructor(
    private readonly canvas: HTMLCanvasElement,
    options: WebGpuRendererOptions,
    construction: GpuRendererConstruction,
  ) {
    this.context = construction.context;
    this.format = construction.format;
    this.depthFormat = construction.depthFormat;
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
    }
    const attachmentChanged = this.attachment.attach(runtime, this.lifecycle.bundle);
    if (attachmentChanged || partsChanged || this.nodeOrdersDirty) {
      this.attachment.updateNodeOrders(this.parts, this.lifecycle.bundle);
      this.nodeOrdersDirty = false;
    }
    syncDeformations(this.lifecycle.bundle.draw, this.deformation);
    syncResultColors(this.lifecycle.bundle.draw, this.resultColors);
    if (this.attachment.layout !== undefined) {
      syncOrientationGlyphs(
        this.lifecycle.bundle.draw.orientationGlyphs,
        this.orientationGlyphs,
        runtime,
        this.attachment.layout,
      );
    }
    if (partsChanged || cameraChanged || attachmentChanged) this.pickSnapshotValid = false;
    encodeVisibleFrame(camera, this.parts, this.frameOptions());
  }

  public resetScene(parts: ReadonlyMap<PartId, Part>): void {
    this.ensureAlive();
    this.attachment.prepareParts(parts, this.lifecycle.bundle);
    this.attachment.clear();
    destroyInstanceResources(this.lifecycle.bundle.draw);
    this.parts = new Map();
    this.sourceParts = undefined;
    this.lastCamera = undefined;
    this.deformation = undefined;
    this.resultColors = undefined;
    this.orientationGlyphs = undefined;
    this.nodeOrdersDirty = true;
    this.pickSnapshotValid = false;
    invalidateEdgePickState(this.edgePick);
  }

  public setDeformation(deformation: DeformationState | undefined): void {
    this.ensureAlive();
    if (deformation !== undefined) validateDeformation(deformation);
    if (this.deformation !== deformation) this.pickSnapshotValid = false;
    this.deformation = deformation;
  }

  public setResultColors(colors: ReadonlyMap<PartId, Float32Array> | undefined): void {
    this.ensureAlive();
    this.resultColors = colors;
    syncResultColors(this.lifecycle.bundle.draw, colors);
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
    if (this.sectionPlane === plane) return;
    this.sectionPlane = plane;
    this.pickSnapshotValid = false;
  }

  public updateInstances(
    runtime: PackedSceneRuntime,
    interaction: InteractionState,
    changedInstanceIds: readonly number[],
  ): void {
    this.ensureAlive();
    if (changedInstanceIds.length > 0) this.nodeOrdersDirty = true;
    if (
      this.attachment.updateInstances(
        runtime,
        interaction,
        changedInstanceIds,
        this.lifecycle.bundle,
      )
    ) {
      this.pickSnapshotValid = false;
    }
  }

  public updateElements(
    runtime: PackedSceneRuntime,
    interaction: InteractionState,
    changedInstanceIds?: readonly number[],
  ): void {
    this.ensureAlive();
    if (
      this.attachment.updateElements(
        runtime,
        interaction,
        this.lifecycle.bundle,
        this.parts,
        changedInstanceIds,
      )
    ) {
      this.pickSnapshotValid = false;
    }
    this.nodeOrdersDirty = false;
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
    this.pickSnapshotValid = false;
  }

  public setNodeSizePixels(size: number): void {
    this.ensureAlive();
    if (this.nodeSize === size) return;
    this.nodeSize = size;
    this.pickSnapshotValid = false;
  }

  public setOrbitPivot(pivot: Vec3 | undefined): void {
    this.ensureAlive();
    this.orbitPivot = pivot;
  }

  public updateVisibility(
    runtime: PackedSceneRuntime,
    changedInstanceIds: readonly number[],
  ): void {
    this.ensureAlive();
    if (changedInstanceIds.length > 0) this.nodeOrdersDirty = true;
    if (this.attachment.updateVisibility(runtime, changedInstanceIds, this.lifecycle.bundle)) {
      this.pickSnapshotValid = false;
    }
  }

  public async pick(x: number, y: number, granularity?: "edge"): Promise<PickHit | undefined> {
    this.ensureAlive();
    if (this.attachment.runtime === undefined) return undefined;
    if (!this.ensurePickSnapshot()) return undefined;
    const camera = this.lastCamera;
    if (camera === undefined) return undefined;
    if (granularity === "edge") {
      return pickEdgePixel(this.edgePickContext(camera), x, y);
    }
    return pickHitFromPixel({
      device: this.lifecycle.bundle.device,
      canvas: this.canvas,
      pick: this.lifecycle.bundle.pickTargets,
      context: { instances: this.attachment.instances, parts: this.parts },
      camera,
      x,
      y,
    });
  }

  public async pickRegion(
    rect: BoxSelectionRect,
    granularity: InteractionGranularity,
  ): Promise<readonly InteractionTarget[]> {
    this.ensureAlive();
    if (this.attachment.runtime === undefined) return [];
    if (!this.ensurePickSnapshot()) return [];
    if (granularity === "edge") {
      const camera = this.lastCamera;
      return camera === undefined ? [] : pickEdgeRegion(this.edgePickContext(camera), rect);
    }
    return pickTargetsFromRegion({
      device: this.lifecycle.bundle.device,
      canvas: this.canvas,
      pick: this.lifecycle.bundle.pickTargets,
      readback: this.lifecycle.bundle.pickTargets.readback,
      context: { instances: this.attachment.instances, parts: this.parts },
      rect,
      granularity,
    });
  }

  public async pickPoint(camera: Camera, x: number, y: number): Promise<Vec3 | undefined> {
    this.ensureAlive();
    if (this.attachment.runtime === undefined) return undefined;
    if (!this.ensurePickSnapshot(camera)) return undefined;
    return displayedPointFromPixel({
      device: this.lifecycle.bundle.device,
      canvas: this.canvas,
      pick: this.lifecycle.bundle.pickTargets,
      camera,
      x,
      y,
    });
  }

  public resize(width = this.canvas.clientWidth, height = this.canvas.clientHeight): void {
    this.canvas.width = Math.max(1, Math.floor(width * devicePixelRatio));
    this.canvas.height = Math.max(1, Math.floor(height * devicePixelRatio));
    this.context.configure({
      device: this.lifecycle.bundle.device,
      format: this.format,
      alphaMode: "opaque",
    });
    resetPickTargets(this.lifecycle.bundle.pickTargets);
    this.pickSnapshotValid = false;
    invalidateEdgePickState(this.edgePick);
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

  public destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
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
      this.attachment.clear();
      this.pickSnapshotValid = false;
      invalidateEdgePickState(this.edgePick);
      this.edgePick.pipeline = undefined;
      this.edgePick.pipelineDevice = undefined;
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

  private ensurePickSnapshot(camera = this.lastCamera): boolean {
    if (camera === undefined) return false;
    if (camera !== this.lastCamera) {
      this.lastCamera = camera;
      this.pickSnapshotValid = false;
    }
    if (!this.pickSnapshotValid) {
      syncDeformations(this.lifecycle.bundle.draw, this.deformation);
      encodePickSnapshot(camera, this.parts, this.frameOptions());
      this.pickSnapshotValid = true;
      invalidateEdgePickState(this.edgePick);
    }
    return true;
  }

  private frameOptions() {
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
      resultColors: this.resultColors,
      orbitPivot: this.orbitPivot,
      originTriadEnabled: this.originTriadEnabled,
      originTriadNominalScale: this.originTriadNominalScale,
    });
  }

  private edgePickContext(camera: Camera) {
    return createEdgePickContext(this.edgePick, camera, this.parts, this.attachment.instances, () =>
      this.frameOptions(),
    );
  }
}
