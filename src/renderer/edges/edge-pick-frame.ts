import type { Camera } from "../../camera/camera";
import type { Part } from "../../geometry/part";
import type { PartId } from "../../geometry/part";
import { drawBatches } from "../frame/batch";
import { beginEdgePickPass } from "../picking/pass";
import { ensureEdgePickTarget } from "../picking/pick";
import { drawContext, writeFrameUniforms } from "../frame/frame";
import type { FrameOptions } from "../frame/frame-types";
import { popDebugGroup, pushDebugGroup } from "../frame/debug";

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
  const encoder = frame.device.createCommandEncoder({ label: "femgx authored edge picking" });
  const timestampFrame = frame.timestampRecorder?.beginFrame();
  const pass = beginEdgePickPass(encoder, frame.pickTargets, timestampFrame?.writes("pick"));
  pushDebugGroup(pass, "authored edge picking");
  frame.draw.cost.pass("pick");
  drawBatches(pass, frame.draw, context, frame.calls, { kind: "edge-pick", pipeline });
  popDebugGroup(pass);
  pass.end();
  if (timestampFrame !== undefined) frame.timestampRecorder?.resolve(encoder, timestampFrame);
  frame.device.queue.submit([encoder.finish()]);
}
