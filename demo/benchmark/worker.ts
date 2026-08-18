import { buildDenseTet4Payload } from "./tet4-transfer";
import { transferBuffers, transferredByteLength, type BenchmarkWorkerResult } from "./transfer";
import type { WebGpuBenchmarkSpec } from "./model";

/** Build request sent to the demo-owned benchmark worker. */
export interface BenchmarkWorkerBuildRequest {
  readonly type: "build";
  readonly requestId: number;
  readonly spec: WebGpuBenchmarkSpec;
}

/** Cancellation request; terminating the worker remains the prompt cancellation mechanism. */
export interface BenchmarkWorkerCancelRequest {
  readonly type: "cancel";
  readonly requestId: number;
}

/** Coarse progress phase emitted only at topology boundaries. */
export interface BenchmarkWorkerProgressMessage {
  readonly type: "progress";
  readonly requestId: number;
  readonly phase: "topology" | "tessellation";
}

/** Worker-side error response with no transferable model data. */
export interface BenchmarkWorkerErrorMessage {
  readonly type: "error";
  readonly requestId: number;
  readonly message: string;
}

export type BenchmarkWorkerRequest = BenchmarkWorkerBuildRequest | BenchmarkWorkerCancelRequest;
export type BenchmarkWorkerResponse =
  BenchmarkWorkerResult | BenchmarkWorkerProgressMessage | BenchmarkWorkerErrorMessage;

const cancelled = new Set<number>();

globalThis.addEventListener("message", (event: MessageEvent<BenchmarkWorkerRequest>) => {
  const request = event.data;
  if (request.type === "cancel") {
    cancelled.add(request.requestId);
    return;
  }
  build(request);
});

function build(request: BenchmarkWorkerBuildRequest): void {
  try {
    if (request.spec.kind !== "structured-fe" || request.spec.structuredFamily !== "tet4") {
      throw new Error(`Worker does not support benchmark case ${request.spec.id}`);
    }
    if (cancelled.has(request.requestId)) return;
    const built = buildDenseTet4Payload(request.spec.gridCells, (phase) => {
      if (!cancelled.has(request.requestId)) {
        globalThis.postMessage({ type: "progress", requestId: request.requestId, phase });
      }
    });
    if (cancelled.has(request.requestId)) return;
    const transferStart = performance.now();
    const buffers = transferBuffers(built.payload);
    const transferPreparationMs = performance.now() - transferStart;
    const result: BenchmarkWorkerResult = {
      type: "result",
      requestId: request.requestId,
      payload: built.payload,
      metrics: {
        ...built.timings,
        transferPreparationMs,
        transferredBytes: transferredByteLength(built.payload),
      },
    };
    globalThis.postMessage(result, { transfer: buffers });
  } catch (error) {
    globalThis.postMessage({
      type: "error",
      requestId: request.requestId,
      message: error instanceof Error ? error.message : String(error),
    });
  } finally {
    cancelled.delete(request.requestId);
  }
}
