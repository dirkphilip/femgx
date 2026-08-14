import type { PartId } from "../geometry/part";
import type { GpuCostAccumulator } from "./gpu-cost";
import type { InstanceStorage } from "./gpu-instance-storage";
import {
  orientationGlyphBindGroup,
  orientationGlyphInstanceBindGroup,
  type OrientationGlyphDrawResources,
} from "./gpu-orientation-glyph";
import type { OrientationGlyphPipelines } from "./gpu-orientation-glyph-pipelines";

interface OrientationGlyphDrawFrame {
  readonly device: GPUDevice;
  readonly draw: {
    readonly cost: GpuCostAccumulator;
    readonly orientationGlyphs: OrientationGlyphDrawResources;
    readonly storages: ReadonlyMap<PartId, InstanceStorage>;
  };
  readonly resources: { readonly orientationGlyphs: OrientationGlyphPipelines };
}

interface OrientationGlyphDrawContext {
  readonly frameBindGroup: GPUBindGroup;
}

interface OrientationGlyphDrawCall {
  readonly partId: PartId;
  readonly instanceCount: number;
}

/** Draws renderer-owned glyphs in either the visible or weighted-ghost pass. */
export function drawOrientationGlyphs(
  pass: GPURenderPassEncoder,
  frame: OrientationGlyphDrawFrame,
  context: OrientationGlyphDrawContext,
  calls: readonly OrientationGlyphDrawCall[],
  variant: "visible" | "hidden",
): void {
  const state = frame.draw.orientationGlyphs.state;
  if (state === undefined) return;
  pass.setPipeline(
    variant === "visible"
      ? frame.resources.orientationGlyphs.visible
      : frame.resources.orientationGlyphs.hidden,
  );
  pass.setBindGroup(0, context.frameBindGroup);
  const vertexCount = state.mode === "axis" ? 6 : 9;
  for (const call of calls) {
    const resource = frame.draw.orientationGlyphs.parts.get(call.partId);
    const storage = frame.draw.storages.get(call.partId);
    if (resource === undefined || storage === undefined) continue;
    pass.setBindGroup(
      1,
      orientationGlyphInstanceBindGroup(
        frame.device,
        resource,
        frame.resources.orientationGlyphs,
        storage,
      ),
    );
    pass.setBindGroup(
      2,
      orientationGlyphBindGroup(
        frame.draw.orientationGlyphs,
        frame.resources.orientationGlyphs,
        resource,
      ),
    );
    pass.draw(vertexCount, call.instanceCount * resource.recordCount);
    frame.draw.cost.draw("vector-glyph", vertexCount, call.instanceCount * resource.recordCount);
  }
}
