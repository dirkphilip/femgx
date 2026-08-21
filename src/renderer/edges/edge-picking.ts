import type { Camera } from "../../camera/camera";
import type { Part, PartId } from "../../geometry/part";
import type { BoxSelectionRect } from "../../interaction/box-selection";
import type { InteractionTarget } from "../../interaction/target-types";
import type { PickHit } from "../../picking/types";
import type { PartOccurrence } from "../../scene/types";
import { resolveEdgePickHit } from "../../picking/pick";
import { encodeEdgePickSnapshot } from "./edge-pick-frame";
import { createEdgePickPipeline } from "./edge-pick-pipeline";
import type { FrameOptions } from "../frame/frame-types";
import { pickWorldPosition, readEdgePickPixel } from "../picking/pick";
import { pickEdgeTargetsFromRegion } from "../picking/region";
import type { GpuValidationOptions } from "../diagnostics/validation";
import { getPartResource } from "../resources/draw-resources";

export interface EdgePickState {
  snapshotValid: boolean;
  pipelineDevice: GPUDevice | undefined;
  pipeline: GPURenderPipeline | undefined;
  readonly validation: GpuValidationOptions | undefined;
}

export interface EdgePickContext {
  readonly state: EdgePickState;
  readonly camera: Camera;
  readonly parts: ReadonlyMap<PartId, Part>;
  readonly instances: readonly (PartOccurrence | undefined)[];
  readonly frame: () => FrameOptions;
}

/** Creates a read-only edge-picking context from the current renderer state. */
export function createEdgePickContext(
  state: EdgePickState,
  camera: Camera,
  parts: ReadonlyMap<PartId, Part>,
  instances: readonly (PartOccurrence | undefined)[],
  frame: () => FrameOptions,
): EdgePickContext {
  return { state, camera, parts, instances, frame };
}

/** Creates the optional edge-picking lifecycle state. */
export function createEdgePickState(validation: GpuValidationOptions | undefined): EdgePickState {
  return { snapshotValid: false, pipelineDevice: undefined, pipeline: undefined, validation };
}

/** Invalidates edge readback state while retaining reusable pipeline state. */
export function invalidateEdgePickState(state: EdgePickState): void {
  state.snapshotValid = false;
}

/** Resolves one exact authored-edge pick after ensuring the lazy edge snapshot. */
export async function pickEdgePixel(
  context: EdgePickContext,
  x: number,
  y: number,
): Promise<PickHit | undefined> {
  await ensureEdgePickSnapshot(context);
  const frame = context.frame();
  const { ids, edgePickId } = await readEdgePickPixel(
    frame.device,
    frame.canvas,
    frame.pickTargets,
    x,
    y,
  );
  if (ids.instancePickId === 0 || ids.ndcDepth >= 1) return undefined;
  const edgeKey = edgeKeyForPickId(context, ids.instancePickId, edgePickId);
  if (edgeKey === undefined) return undefined;
  return resolveEdgePickHit(
    { instances: context.instances, parts: context.parts },
    ids.instancePickId,
    edgeKey,
    pickWorldPosition(frame.canvas, context.camera, x, y, ids.ndcDepth),
  );
}

/** Resolves unique authored-edge targets from the lazy edge region snapshot. */
export async function pickEdgeRegion(
  context: EdgePickContext,
  rect: BoxSelectionRect,
): Promise<readonly InteractionTarget[]> {
  await ensureEdgePickSnapshot(context);
  const frame = context.frame();
  return pickEdgeTargetsFromRegion({
    device: frame.device,
    canvas: frame.canvas,
    pick: frame.pickTargets,
    readback: frame.pickTargets.readback,
    context: { instances: context.instances, parts: context.parts },
    draw: frame.draw,
    rect,
  });
}

async function ensureEdgePickSnapshot(context: EdgePickContext): Promise<void> {
  if (context.state.snapshotValid) return;
  const frame = context.frame();
  const pipeline = await ensureEdgePickPipeline(context.state, frame);
  encodeEdgePickSnapshot(context.camera, context.parts, frame, pipeline);
  context.state.snapshotValid = true;
}

async function ensureEdgePickPipeline(
  state: EdgePickState,
  frame: FrameOptions,
): Promise<GPURenderPipeline> {
  if (state.pipelineDevice === frame.device && state.pipeline !== undefined) {
    return state.pipeline;
  }
  const pipeline = await createEdgePickPipeline({
    device: frame.device,
    layout: frame.resources.pipelineLayout,
    depthFormat: frame.depthFormat,
    ...(state.validation === undefined ? {} : { validation: state.validation }),
  });
  state.pipelineDevice = frame.device;
  state.pipeline = pipeline;
  return pipeline;
}

function edgeKeyForPickId(
  context: EdgePickContext,
  instancePickId: number,
  edgePickId: number,
): string | undefined {
  if (edgePickId <= 0) return undefined;
  const instance = context.instances[instancePickId - 1];
  if (instance === undefined) return undefined;
  const resource = getPartResource(context.frame().draw, instance.partId, "triangles");
  return resource?.edgePick?.edgeKeys[edgePickId - 1];
}
