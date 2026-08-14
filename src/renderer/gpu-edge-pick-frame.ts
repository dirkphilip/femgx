import type { Camera } from "../camera/camera";
import type { Part } from "../geometry/part";
import type { PartId } from "../geometry/part";
import { drawBatches } from "./gpu-batch";
import { beginEdgePickPass } from "./gpu-pick-pass";
import { ensureEdgePickTarget } from "./gpu-pick";
import { drawContext, type FrameOptions, writeFrameUniforms } from "./gpu-frame";

/** Encodes the optional authored-edge pick snapshot over ordinary pick depth. */
export function encodeEdgePickSnapshot(
  camera: Camera,
  parts: ReadonlyMap<PartId, Part>,
  frame: FrameOptions,
  pipeline: GPURenderPipeline,
): void {
  writeFrameUniforms(camera, frame);
  ensureEdgePickTarget(frame.device, frame.pickTargets, frame.canvas.width, frame.canvas.height);
  const context = drawContext(frame, parts);
  const encoder = frame.device.createCommandEncoder();
  const pass = beginEdgePickPass(encoder, frame.pickTargets);
  frame.draw.cost.pass("pick");
  drawBatches(pass, frame.draw, context, frame.calls, { kind: "edge-pick", pipeline });
  pass.end();
  frame.device.queue.submit([encoder.finish()]);
}
