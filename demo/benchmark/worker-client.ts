import type { WebGpuBenchmarkSpec } from "./model";
import type {
  BenchmarkWorkerBuildRequest,
  BenchmarkWorkerCancelRequest,
  BenchmarkWorkerResponse,
} from "./worker";
import type { BenchmarkWorkerResult } from "./transfer";

/** One lazy worker-backed model load with explicit cancellation ownership. */
export interface BenchmarkWorkerLoad<T> {
  readonly load: () => Promise<T>;
  readonly cancel: () => void;
  readonly subscribeProgress: (
    listener: (phase: "topology" | "tessellation") => void,
  ) => () => void;
}

/** Creates the single-use worker lifecycle for one active heavy benchmark build. */
export function createBenchmarkWorkerLoad<T>(
  spec: WebGpuBenchmarkSpec,
  reconstruct: (result: BenchmarkWorkerResult, transferMs: number) => T,
): BenchmarkWorkerLoad<T> {
  let nextRequestId = 0;
  let active: PendingLoad<T> | undefined;
  const progressListeners = new Set<(phase: "topology" | "tessellation") => void>();

  const load = (): Promise<T> => {
    if (active !== undefined) throw new Error("A benchmark worker build is already active");
    const requestId = ++nextRequestId;
    const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    const postedAt = performance.now();
    let settled = false;
    let resolvePromise: ((value: T) => void) | undefined;
    let rejectPromise: ((reason: unknown) => void) | undefined;
    const promise = new Promise<T>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });
    const pending: PendingLoad<T> = {
      requestId,
      worker,
      promise,
      reject: (reason) => {
        if (settled) return;
        settled = true;
        active = undefined;
        worker.terminate();
        rejectPromise?.(reason);
      },
    };
    active = pending;
    worker.onmessage = (event: MessageEvent<BenchmarkWorkerResponse>) => {
      const message = event.data;
      if (message.requestId !== requestId || settled) return;
      if (message.type === "progress") {
        for (const listener of progressListeners) listener(message.phase);
        return;
      }
      if (message.type === "error") {
        pending.reject(new Error(message.message));
        return;
      }
      settled = true;
      active = undefined;
      worker.terminate();
      try {
        resolvePromise?.(reconstruct(message, performance.now() - postedAt));
      } catch (error) {
        rejectPromise?.(error);
      }
    };
    worker.onerror = (event) => {
      pending.reject(new Error(event.message || "Benchmark worker failed"));
    };
    worker.onmessageerror = () => {
      pending.reject(new Error("Benchmark worker returned an unreadable result"));
    };
    const request: BenchmarkWorkerBuildRequest = { type: "build", requestId, spec };
    try {
      worker.postMessage(request);
    } catch (error) {
      pending.reject(error);
    }
    return promise;
  };

  return {
    load,
    cancel: () => {
      const pending = active;
      if (pending === undefined) return;
      const request: BenchmarkWorkerCancelRequest = {
        type: "cancel",
        requestId: pending.requestId,
      };
      try {
        pending.worker.postMessage(request);
      } catch {
        // Termination below is the authoritative cancellation path.
      }
      pending.reject(new Error("Benchmark build cancelled"));
    },
    subscribeProgress: (listener) => {
      progressListeners.add(listener);
      return () => progressListeners.delete(listener);
    },
  };
}

interface PendingLoad<T> {
  readonly requestId: number;
  readonly worker: Worker;
  readonly promise: Promise<T>;
  readonly reject: (reason: unknown) => void;
}
