import { drawBatches } from "./batch";
import type { DrawCallContext, DrawResources, DrawCall } from "../resources/draw-resources";

type CapPass = "color" | "transparent" | "pick";

/** Draws generated cap triangles through the ordinary surface pipeline. */
export function drawSectionCaps(
  pass: GPURenderPassEncoder,
  draw: DrawResources,
  context: DrawCallContext,
  calls: readonly DrawCall[] | undefined,
  intent: CapPass,
): void {
  if (calls === undefined || calls.length === 0) return;
  drawBatches(pass, draw, context, calls, {
    kind: "surface",
    pass: intent,
    primitive: "triangles",
  });
}
