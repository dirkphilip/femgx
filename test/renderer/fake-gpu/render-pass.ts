import type { DrawCall, PipelineDraw } from "./types";

export interface RenderPassState {
  readonly drawCalls: DrawCall[];
  readonly pipelineDraws: PipelineDraw[];
  readonly pipelineCalls: unknown[];
  readonly counters: { currentPipeline: string };
}

/** Creates a recording render pass used by draw-path tests. */
export function createRenderPass(state: RenderPassState): GPURenderPassEncoder {
  return {
    setPipeline: (pipeline: { readonly __tag?: string }) => {
      state.pipelineCalls.push(pipeline);
      state.counters.currentPipeline = pipeline.__tag ?? "unknown";
    },
    setBindGroup: () => undefined,
    setStencilReference: () => undefined,
    setVertexBuffer: () => undefined,
    setIndexBuffer: () => undefined,
    drawIndexed: (
      indexCount: number,
      instanceCount: number,
      firstIndex = 0,
      _baseVertex = 0,
      firstInstance = 0,
    ) => {
      recordDraw(state, {
        indexCount,
        instanceCount,
        ...(firstIndex === 0 ? {} : { firstIndex }),
        ...(firstInstance === 0 ? {} : { firstInstance }),
      });
    },
    draw: (
      vertexCount: number,
      instanceCount: number,
      firstVertex: number | undefined,
      firstInstance: number | undefined,
    ) => {
      if (firstVertex === undefined || firstInstance === undefined) return;
      recordDraw(state, {
        vertexCount,
        instanceCount,
        ...(firstVertex === 0 ? {} : { firstVertex }),
        ...(firstInstance === 0 ? {} : { firstInstance }),
      });
    },
    end: () => undefined,
  } as unknown as GPURenderPassEncoder;
}

function recordDraw(state: RenderPassState, call: DrawCall): void {
  state.drawCalls.push(call);
  state.pipelineDraws.push({ pipeline: state.counters.currentPipeline, ...call });
}
