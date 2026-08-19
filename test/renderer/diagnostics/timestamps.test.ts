import { afterEach, describe, expect, it } from "vitest";
import {
  createGpuTimestampRecorder,
  type GpuTimestampRecorder,
} from "../../../src/renderer/diagnostics/timestamps";
import { GPU_COST_PASSES } from "../../../src/renderer/diagnostics/cost";
import { fakeGpuDevice, installGpuGlobals } from "../fake-gpu";

let restoreGlobals: (() => void) | undefined;

afterEach(() => {
  restoreGlobals?.();
  restoreGlobals = undefined;
});

function timestampValues(
  update?: (index: number, start: bigint, end: bigint) => readonly [bigint, bigint],
): bigint[] {
  const values: bigint[] = [];
  for (const [index] of GPU_COST_PASSES.entries()) {
    const start = BigInt(index + 1) * 100n;
    const end = start + 5n;
    const pair = update?.(index, start, end) ?? [start, end];
    values.push(pair[0], pair[1]);
  }
  return values;
}

async function submitFrame(recorder: GpuTimestampRecorder, device: GPUDevice): Promise<void> {
  const frame = recorder.beginFrame();
  if (frame === undefined) throw new Error("timestamp pool unexpectedly exhausted");
  frame.writes("opaque");
  frame.writes("transparency");
  const encoder = device.createCommandEncoder();
  recorder.resolve(encoder, frame);
  device.queue.submit([encoder.finish()]);
  await Promise.resolve();
}

describe("GPU timestamp diagnostics", () => {
  it("does not allocate query resources when timestamp-query is unavailable", () => {
    restoreGlobals = installGpuGlobals();
    const gpu = fakeGpuDevice();

    expect(createGpuTimestampRecorder(gpu.device, true)).toBeUndefined();
    expect(gpu.querySetCreations).toBe(0);
    expect(gpu.buffers).toHaveLength(0);
  });

  it("rotates bounded readbacks and waits two later frames before mapping", async () => {
    restoreGlobals = installGpuGlobals();
    const gpu = fakeGpuDevice({
      features: ["timestamp-query"],
      timestampPeriod: 2,
      timestampValues: timestampValues(),
    });
    const recorder = createGpuTimestampRecorder(gpu.device, true);
    if (recorder === undefined) throw new Error("timestamp recorder was not enabled");

    await submitFrame(recorder, gpu.device);
    await submitFrame(recorder, gpu.device);
    expect(gpu.mapAsyncCount).toBe(0);
    await submitFrame(recorder, gpu.device);
    await Promise.resolve();
    expect(gpu.mapAsyncCount).toBe(1);
    await submitFrame(recorder, gpu.device);
    await submitFrame(recorder, gpu.device);
    await recorder.drain();

    const snapshot = recorder.snapshot();
    expect(gpu.querySetCreations).toBe(1);
    expect(gpu.buffers).toHaveLength(6);
    expect(gpu.queryResolveCount).toBe(5);
    expect(snapshot.sampleCount).toBe(5);
    expect(snapshot.unit).toBe("nanoseconds");
    expect(snapshot.periodNs).toBe(2);
    expect(snapshot.passes.opaque).toMatchObject({
      sampleCount: 5,
      p50: 10,
      p95: 10,
      p99: 10,
      invalidSampleCount: 0,
      disjointSampleCount: 0,
    });

    recorder.destroy();
    expect(gpu.buffers.every((buffer) => buffer.destroyed)).toBe(true);
  });

  it("reports invalid and disjoint timestamp results without fabricating duration", async () => {
    restoreGlobals = installGpuGlobals();
    const gpu = fakeGpuDevice({
      features: ["timestamp-query"],
      timestampValues: timestampValues((index, start, end) => {
        if (index === 0) return [0xffffffffffffffffn, end];
        if (index === 1) return [start + 10n, start];
        return [start, end];
      }),
    });
    const recorder = createGpuTimestampRecorder(gpu.device, true);
    if (recorder === undefined) throw new Error("timestamp recorder was not enabled");

    await submitFrame(recorder, gpu.device);
    await recorder.drain();

    const snapshot = recorder.snapshot();
    expect(snapshot.invalidSampleCount).toBe(1);
    expect(snapshot.disjointSampleCount).toBe(1);
    expect(snapshot.passes.opaque).toMatchObject({
      sampleCount: 0,
      p50: null,
      invalidSampleCount: 1,
      disjointSampleCount: 1,
    });
    expect(snapshot.passes.transparency).toMatchObject({
      sampleCount: 0,
      p50: null,
      invalidSampleCount: 1,
      disjointSampleCount: 0,
    });
  });
});
