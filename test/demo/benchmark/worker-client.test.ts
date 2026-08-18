import { afterEach, describe, expect, it, vi } from "vitest";
import { benchmarkCaseSpecs } from "../../../demo/benchmark/model";
import { buildDenseTet4Payload } from "../../../demo/benchmark/tet4-transfer";
import {
  createBenchmarkWorkerLoad,
  type BenchmarkWorkerLoad,
} from "../../../demo/benchmark/worker-client";
import type {
  BenchmarkWorkerBuildRequest,
  BenchmarkWorkerResponse,
} from "../../../demo/benchmark/worker";
import type { BenchmarkWorkerResult } from "../../../demo/benchmark/transfer";

class FakeWorker {
  static readonly instances: FakeWorker[] = [];
  onmessage: ((event: MessageEvent<BenchmarkWorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  readonly messages: unknown[] = [];
  terminated = false;

  constructor() {
    FakeWorker.instances.push(this);
  }

  postMessage(message: unknown): void {
    this.messages.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  respond(message: BenchmarkWorkerResponse): void {
    this.onmessage?.({ data: message } as MessageEvent<BenchmarkWorkerResponse>);
  }
}

describe("benchmark worker client", () => {
  afterEach(() => {
    FakeWorker.instances.length = 0;
    vi.unstubAllGlobals();
  });

  it("terminates cancellation and ignores the stale result", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const spec = heavySpec();
    const load = createBenchmarkWorkerLoad(spec, (result) => result.requestId);
    const pending = load.load();
    const worker = FakeWorker.instances[0];
    if (worker === undefined) throw new Error("Worker was not created");
    const request = worker.messages[0] as BenchmarkWorkerBuildRequest;

    load.cancel();
    await expect(pending).rejects.toThrow("cancelled");
    expect(worker.terminated).toBe(true);
    worker.respond(resultFor(request.requestId));
    expect(FakeWorker.instances).toHaveLength(1);
  });

  it("uses a monotonic request id after a cancelled build", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const spec = heavySpec();
    const load: BenchmarkWorkerLoad<number> = createBenchmarkWorkerLoad(
      spec,
      (result) => result.requestId,
    );
    const first = load.load();
    load.cancel();
    await expect(first).rejects.toThrow();
    const second = load.load();
    const worker = FakeWorker.instances[1];
    if (worker === undefined) throw new Error("Second worker was not created");
    const request = worker.messages[0] as BenchmarkWorkerBuildRequest;
    expect(request.requestId).toBe(2);
    worker.respond(resultFor(request.requestId));
    await expect(second).resolves.toBe(2);
    expect(worker.terminated).toBe(true);
  });

  it("leaves retained-byte accounting to the main-thread reconstruction", () => {
    const metrics: BenchmarkWorkerResult["metrics"] = {
      generationMs: 0,
      topologyMs: 0,
      tessellationMs: 0,
      transferPreparationMs: 0,
      transferredBytes: 0,
    };

    expect(metrics).not.toHaveProperty("finalRetainedTypedBytes");
  });
});

function heavySpec() {
  const spec = benchmarkCaseSpecs(false).find((candidate) => candidate.id === "fe-tet4-solid-132k");
  if (spec === undefined) throw new Error("Tet4 benchmark spec is missing");
  return spec;
}

function resultFor(requestId: number): BenchmarkWorkerResult {
  const payload = buildDenseTet4Payload(1).payload;
  return {
    type: "result",
    requestId,
    payload,
    metrics: {
      generationMs: 0,
      topologyMs: 0,
      tessellationMs: 0,
      transferPreparationMs: 0,
      transferredBytes: 0,
    },
  };
}
