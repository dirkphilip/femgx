import type { Part, Viewport } from "@/entries/root";
import type { GpuCostSnapshot } from "@/renderer/diagnostics/cost";

/** Returns internal draw ownership for benchmark identity assertions. */
export function rendererDraw(viewport: Viewport) {
  const owner = viewport as unknown as {
    readonly renderer: { readonly lifecycle: { readonly bundle: { readonly draw: unknown } } };
  };
  return owner.renderer.lifecycle.bundle.draw as {
    readonly resultColors: ReadonlyMap<number, { readonly buffer: GPUBuffer }>;
    readonly deformations: ReadonlyMap<number, { readonly buffer: GPUBuffer }>;
    readonly storages: ReadonlyMap<
      number,
      { readonly buffer: GPUBuffer; readonly orderBuffer: GPUBuffer; readonly bindGroup: unknown }
    >;
    readonly primitiveParts: ReadonlyMap<
      number,
      ReadonlyMap<"triangles", { readonly vertexBuffer: GPUBuffer }>
    >;
    readonly orientationGlyphs: { readonly parts: ReadonlyMap<number, unknown> };
  };
}

/** Returns the renderer-private current cap frame. */
export function rendererCaps(viewport: Viewport) {
  return (
    viewport as unknown as {
      readonly renderer: {
        readonly sectionCaps: {
          readonly currentFrame: {
            readonly parts: ReadonlyMap<number, Part>;
            readonly sourcePartIds: ReadonlyMap<number, number>;
          };
        };
      };
    }
  ).renderer.sectionCaps.currentFrame;
}

/** Resolves one cap part by source definition. */
export function capPartForSource(
  frame: ReturnType<typeof rendererCaps>,
  sourcePartId: number,
): Part | undefined {
  const capId = capForSource(frame, sourcePartId);
  return capId === undefined ? undefined : frame.parts.get(capId);
}

/** Resolves the uploaded cap vertex buffer by source definition. */
export function capVertexBuffer(
  viewport: Viewport,
  frame: ReturnType<typeof rendererCaps>,
  sourcePartId: number,
): GPUBuffer | undefined {
  const capId = capForSource(frame, sourcePartId);
  return capId === undefined
    ? undefined
    : rendererDraw(viewport).primitiveParts.get(capId)?.get("triangles")?.vertexBuffer;
}

/** Returns counters checkpointed at the last revision commit. */
export function rendererRevisionCost(viewport: Viewport): GpuCostSnapshot {
  return (
    viewport as unknown as {
      readonly renderer: {
        readonly lifecycle: {
          readonly bundle: {
            readonly draw: { readonly cost: { transactionSnapshot(): GpuCostSnapshot } };
          };
        };
      };
    }
  ).renderer.lifecycle.bundle.draw.cost.transactionSnapshot();
}

/** Returns the exact changed-leaf count from the last bounds update. */
export function viewportBoundsLeaves(viewport: Viewport): number {
  return (
    viewport as unknown as {
      readonly sceneController: { readonly placedBounds: { lastUpdatedLeafCount: number } };
    }
  ).sceneController.placedBounds.lastUpdatedLeafCount;
}

/** Returns the active renderer-private cap count. */
export function rendererCapCount(viewport: Viewport): number {
  return rendererCaps(viewport).parts.size;
}

function capForSource(
  frame: ReturnType<typeof rendererCaps>,
  sourcePartId: number,
): number | undefined {
  for (const [capId, partId] of frame.sourcePartIds) if (partId === sourcePartId) return capId;
  return undefined;
}
