import type { Camera } from "../../camera/camera";
import type { BoxSelectionRect } from "../../interaction/box-selection";
import type { InteractionTarget } from "../../interaction/target-types";
import type { ElementRegionSelection } from "../../interaction/element-region-selection";
import type { InteractionGranularity, PickHit } from "../../picking/types";
import type { Part, PartId } from "../../geometry/part";
import type { Vec3 } from "../../math/vec3";
import type { RendererAttachment } from "../attachment";
import type { RendererResultSnapshot } from "../attachment/part-revision-results";
import type { FrameOptions } from "../frame/frame-types";
import { encodePickSnapshot } from "../frame/frame";
import type { GpuDeviceLifecycle } from "../recovery";
import {
  createEdgePickContext,
  pickEdgePixel,
  pickEdgeRegion,
  type EdgePickState,
} from "../edges/edge-picking";
import { pickHitFromPixel, resetPickTargets } from "./pick";
import { assemblyPathForInstance } from "./assembly-path";
import { pickTargetsFromRegion } from "./region";
import { createElementPickScratch } from "./element-region";
import { syncDeformations } from "../frame/deformation";
import type { SectionCapController } from "../section-cap-controller";

export interface RendererPickingHost {
  readonly canvas: HTMLCanvasElement;
  readonly lifecycle: GpuDeviceLifecycle;
  readonly attachment: RendererAttachment;
  readonly edgePick: EdgePickState;
  readonly sectionCaps: SectionCapController;
  readonly parts: ReadonlyMap<PartId, Part>;
  lastCamera: Camera | undefined;
  readonly results: RendererResultSnapshot | undefined;
  ensureSectionCaps(runtime: NonNullable<RendererAttachment["runtime"]>): void;
  frameOptions(): FrameOptions;
}

/** Owns the lazy ordinary/edge pick snapshots and their invalidation state. */
export class RendererPicking {
  private snapshotValid = false;

  private readonly elementScratch = createElementPickScratch();

  public constructor(private readonly owner: RendererPickingHost) {}

  public invalidate(): void {
    this.snapshotValid = false;
    this.owner.edgePick.snapshotValid = false;
  }

  public resetAfterRecovery(): void {
    this.invalidate();
    this.owner.edgePick.pipeline = undefined;
    this.owner.edgePick.pipelineDevice = undefined;
  }

  public resize(): void {
    resetPickTargets(this.owner.lifecycle.bundle.pickTargets);
    this.invalidate();
  }

  public async pick(x: number, y: number, granularity?: "edge"): Promise<PickHit | undefined> {
    if (this.owner.attachment.runtime === undefined) return undefined;
    if (!this.ensureSnapshot()) return undefined;
    const camera = this.owner.lastCamera;
    if (camera === undefined) return undefined;
    if (granularity === "edge") return pickEdgePixel(this.edgeContext(camera), x, y);
    return pickHitFromPixel({
      device: this.owner.lifecycle.bundle.device,
      canvas: this.owner.canvas,
      pick: this.owner.lifecycle.bundle.pickTargets,
      context: this.pickContext(),
      camera,
      x,
      y,
    });
  }

  public async pickRegion(
    rect: BoxSelectionRect,
    granularity: InteractionGranularity,
  ): Promise<ElementRegionSelection | readonly InteractionTarget[]> {
    if (this.owner.attachment.runtime === undefined) return emptyRegion(granularity);
    if (!this.ensureSnapshot()) return emptyRegion(granularity);
    if (granularity === "edge") {
      const camera = this.owner.lastCamera;
      return camera === undefined ? [] : pickEdgeRegion(this.edgeContext(camera), rect);
    }
    const pick = this.owner.lifecycle.bundle.pickTargets;
    return pickTargetsFromRegion({
      device: this.owner.lifecycle.bundle.device,
      canvas: this.owner.canvas,
      pick,
      readback: pick.readback,
      context: this.pickContext(),
      rect,
      granularity,
      elementScratch: this.elementScratch,
    });
  }

  public async pickPoint(camera: Camera, x: number, y: number): Promise<Vec3 | undefined> {
    if (this.owner.attachment.runtime === undefined) return undefined;
    if (!this.ensureSnapshot(camera)) return undefined;
    const hit = await pickHitFromPixel({
      device: this.owner.lifecycle.bundle.device,
      canvas: this.owner.canvas,
      pick: this.owner.lifecycle.bundle.pickTargets,
      context: this.pickContext(),
      camera,
      x,
      y,
    });
    return hit?.worldPosition;
  }

  private ensureSnapshot(camera = this.owner.lastCamera): boolean {
    if (camera === undefined) return false;
    if (camera !== this.owner.lastCamera) {
      this.owner.lastCamera = camera;
      this.invalidate();
    }
    if (!this.snapshotValid) {
      const runtime = this.owner.attachment.runtime;
      const layout = this.owner.attachment.layout;
      if (runtime === undefined || layout === undefined) return false;
      syncDeformations(
        this.owner.lifecycle.bundle.draw,
        this.owner.results?.deformation,
        runtime,
        layout,
      );
      this.owner.ensureSectionCaps(runtime);
      encodePickSnapshot(camera, this.owner.parts, this.owner.frameOptions());
      this.snapshotValid = true;
      this.owner.edgePick.snapshotValid = false;
    }
    return true;
  }

  private edgeContext(camera: Camera) {
    return createEdgePickContext({
      state: this.owner.edgePick,
      camera,
      parts: this.owner.parts,
      instances: this.owner.attachment.instances,
      frame: this.owner.frameOptions(),
      runtime: this.owner.attachment.runtime,
    });
  }

  private pickContext() {
    const runtime = this.owner.attachment.runtime;
    return {
      instances: this.owner.attachment.instances,
      parts: this.owner.parts,
      ...(runtime === undefined
        ? {}
        : { assemblyPath: (slot: number) => assemblyPathForInstance(runtime, slot) }),
    };
  }
}

function emptyRegion(
  granularity: InteractionGranularity,
): ElementRegionSelection | readonly InteractionTarget[] {
  return granularity === "element"
    ? {
        kind: "element",
        count: 0,
        partOccurrenceIds: [],
        offsets: new Uint32Array([0]),
        elementIds: new Uint32Array(),
      }
    : [];
}
