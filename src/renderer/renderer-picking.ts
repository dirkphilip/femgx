import type { Camera } from "../camera/camera";
import type { BoxSelectionRect } from "../interaction/box-selection";
import type { InteractionTarget } from "../interaction/target-types";
import type { InteractionGranularity } from "../picking/types";
import type { Part, PartId } from "../geometry/part";
import type { Vec3 } from "../math/vec3";
import type { PickHit } from "../picking/types";
import type { DeformationState } from "../results/deform";
import type { RendererAttachment } from "./attachment";
import type { FrameOptions } from "./frame/frame-types";
import { encodePickSnapshot } from "./frame/frame";
import type { GpuDeviceLifecycle } from "./recovery";
import {
  createEdgePickContext,
  pickEdgePixel,
  pickEdgeRegion,
  type EdgePickState,
} from "./edges/edge-picking";
import { pickHitFromPixel, resetPickTargets } from "./picking/pick";
import { pickTargetsFromRegion } from "./picking/region";
import { syncDeformations } from "./frame/deformation";
import type { SectionCapController } from "./section-cap-controller";

interface RendererPickingOwner {
  readonly canvas: HTMLCanvasElement;
  readonly lifecycle: GpuDeviceLifecycle;
  readonly attachment: RendererAttachment;
  readonly edgePick: EdgePickState;
  readonly sectionCaps: SectionCapController;
  readonly parts: () => ReadonlyMap<PartId, Part>;
  readonly lastCamera: () => Camera | undefined;
  readonly setLastCamera: (camera: Camera) => void;
  readonly deformation: () => DeformationState | undefined;
  readonly ensureSectionCaps: (runtime: NonNullable<RendererAttachment["runtime"]>) => void;
  readonly frameOptions: () => FrameOptions;
}

/** Owns the lazy ordinary/edge pick snapshots and their invalidation state. */
export class RendererPicking {
  private snapshotValid = false;

  public constructor(private readonly owner: RendererPickingOwner) {}

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
    const camera = this.owner.lastCamera();
    if (camera === undefined) return undefined;
    if (granularity === "edge") return pickEdgePixel(this.edgeContext(camera), x, y);
    return pickHitFromPixel({
      device: this.owner.lifecycle.bundle.device,
      canvas: this.owner.canvas,
      pick: this.owner.lifecycle.bundle.pickTargets,
      context: { instances: this.owner.attachment.instances, parts: this.owner.parts() },
      camera,
      x,
      y,
    });
  }

  public async pickRegion(
    rect: BoxSelectionRect,
    granularity: InteractionGranularity,
  ): Promise<readonly InteractionTarget[]> {
    if (this.owner.attachment.runtime === undefined) return [];
    if (!this.ensureSnapshot()) return [];
    if (granularity === "edge") {
      const camera = this.owner.lastCamera();
      return camera === undefined ? [] : pickEdgeRegion(this.edgeContext(camera), rect);
    }
    const pick = this.owner.lifecycle.bundle.pickTargets;
    return pickTargetsFromRegion({
      device: this.owner.lifecycle.bundle.device,
      canvas: this.owner.canvas,
      pick,
      readback: pick.readback,
      context: { instances: this.owner.attachment.instances, parts: this.owner.parts() },
      rect,
      granularity,
    });
  }

  public async pickPoint(camera: Camera, x: number, y: number): Promise<Vec3 | undefined> {
    if (this.owner.attachment.runtime === undefined) return undefined;
    if (!this.ensureSnapshot(camera)) return undefined;
    const hit = await pickHitFromPixel({
      device: this.owner.lifecycle.bundle.device,
      canvas: this.owner.canvas,
      pick: this.owner.lifecycle.bundle.pickTargets,
      context: { instances: this.owner.attachment.instances, parts: this.owner.parts() },
      camera,
      x,
      y,
    });
    return hit?.worldPosition;
  }

  private ensureSnapshot(camera = this.owner.lastCamera()): boolean {
    if (camera === undefined) return false;
    if (camera !== this.owner.lastCamera()) {
      this.owner.setLastCamera(camera);
      this.invalidate();
    }
    if (!this.snapshotValid) {
      const runtime = this.owner.attachment.runtime;
      const layout = this.owner.attachment.layout;
      if (runtime === undefined || layout === undefined) return false;
      syncDeformations(this.owner.lifecycle.bundle.draw, this.owner.deformation(), runtime, layout);
      this.owner.ensureSectionCaps(runtime);
      encodePickSnapshot(camera, this.owner.sectionCaps.parts, this.owner.frameOptions());
      this.snapshotValid = true;
      this.owner.edgePick.snapshotValid = false;
    }
    return true;
  }

  private edgeContext(camera: Camera) {
    return createEdgePickContext(
      this.owner.edgePick,
      camera,
      this.owner.parts(),
      this.owner.attachment.instances,
      this.owner.frameOptions,
    );
  }
}
