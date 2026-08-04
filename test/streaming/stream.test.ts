import { describe, expect, it } from "vitest";
import type { ParsedChunk } from "../../src/streaming/chunk";
import { parseChunk } from "../../src/streaming/parser";
import { createChunkStream } from "../../src/streaming/stream";
import { quadChunk } from "./fixtures";

const QUAD_BYTES = 48 + 24;

function collect(sources: Parameters<typeof createChunkStream>[0]) {
  const emitted: ParsedChunk[] = [];
  const stream = createChunkStream(sources, { onChunk: (chunk) => emitted.push(chunk) });
  return { stream, emitted };
}

describe("createChunkStream", () => {
  it("emits chunks in deterministic model order regardless of input order", () => {
    const { stream, emitted } = collect([
      quadChunk(2, 2, 0),
      quadChunk(1, 1, 0),
      quadChunk(3, 0, 0),
    ]);
    expect(stream.tick()).toBe(true);
    expect(emitted.map((chunk) => chunk.chunkId)).toEqual([3, 1, 2]);
    expect(stream.loaded).toBe(3);
    expect(stream.skipped).toBe(0);
    expect(stream.done).toBe(true);
    expect(stream.total).toBe(3);
  });

  it("breaks index ties deterministically by chunk id", () => {
    const { stream, emitted } = collect([quadChunk(2, 0, 0), quadChunk(1, 0, 0)]);
    stream.tick();
    expect(emitted.map((chunk) => chunk.chunkId)).toEqual([1, 2]);
  });

  it("honors a per-tick byte budget as backpressure", () => {
    const emitted: ParsedChunk[] = [];
    const stream = createChunkStream([quadChunk(1, 0, 0), quadChunk(2, 1, 0), quadChunk(3, 2, 0)], {
      budgetBytesPerTick: QUAD_BYTES,
      onChunk: (chunk) => emitted.push(chunk),
    });
    expect(stream.tick()).toBe(false);
    expect(stream.loaded).toBe(1);
    expect(stream.tick()).toBe(false);
    expect(stream.loaded).toBe(2);
    expect(stream.tick()).toBe(true);
    expect(stream.loaded).toBe(3);
    expect(stream.uploadedBytes).toBe(QUAD_BYTES * 3);
    expect(stream.pendingBytes).toBe(0);
  });

  it("defers a chunk larger than the tick budget until budget allows", () => {
    const stream = createChunkStream([quadChunk(1, 0, 0)], { budgetBytesPerTick: 10 });
    expect(stream.tick()).toBe(false);
    expect(stream.loaded).toBe(0);
    expect(stream.pendingBytes).toBe(QUAD_BYTES);
  });

  it("skips hidden or off-screen chunks without uploading them", () => {
    const emitted: ParsedChunk[] = [];
    const stream = createChunkStream([quadChunk(1, 0, 0), quadChunk(2, 1, 0), quadChunk(3, 2, 0)], {
      isVisible: (source) => source.chunkId !== 2,
      onChunk: (chunk) => emitted.push(chunk),
    });
    expect(stream.tick()).toBe(true);
    expect(emitted.map((chunk) => chunk.chunkId)).toEqual([1, 3]);
    expect(stream.skipped).toBe(1);
    expect(stream.uploadedBytes).toBe(QUAD_BYTES * 2);
  });

  it("applies a local origin through to the parser", () => {
    const emitted: ParsedChunk[] = [];
    const stream = createChunkStream([quadChunk(1, 0, 10)], {
      origin: [10, 0, 0],
      onChunk: (chunk) => emitted.push(chunk),
    });
    stream.tick();
    expect(emitted[0]?.positions[0]).toBe(-0.5);
    expect(emitted[0]?.bounds.maxX).toBe(0.5);
  });

  it("cancels before further ticks and skips remaining chunks", () => {
    const emitted: ParsedChunk[] = [];
    const stream = createChunkStream([quadChunk(1, 0, 0), quadChunk(2, 1, 0)], {
      onChunk: (chunk) => emitted.push(chunk),
    });
    stream.cancel();
    expect(stream.cancelled).toBe(true);
    expect(stream.done).toBe(true);
    expect(stream.tick()).toBe(true);
    expect(emitted).toHaveLength(0);
  });

  it("stops when the abort signal fires before the next tick", () => {
    const controller = new AbortController();
    const emitted: ParsedChunk[] = [];
    const stream = createChunkStream([quadChunk(1, 0, 0), quadChunk(2, 1, 0)], {
      signal: controller.signal,
      onChunk: (chunk) => emitted.push(chunk),
    });
    controller.abort();
    expect(stream.tick()).toBe(true);
    expect(stream.cancelled).toBe(true);
    expect(stream.done).toBe(true);
    expect(emitted).toHaveLength(0);
  });

  it("disposes pending buffers and stops emitting", () => {
    const emitted: ParsedChunk[] = [];
    const stream = createChunkStream([quadChunk(1, 0, 0), quadChunk(2, 1, 0)], {
      onChunk: (chunk) => emitted.push(chunk),
    });
    stream.dispose();
    expect(stream.disposed).toBe(true);
    expect(stream.done).toBe(true);
    expect(stream.tick()).toBe(true);
    expect(stream.loaded).toBe(0);
    expect(stream.pendingBytes).toBe(0);
    expect(emitted).toHaveLength(0);
  });

  it("supports an injected parse strategy", () => {
    let parseCalls = 0;
    const stream = createChunkStream([quadChunk(1, 0, 0)], {
      parse: (source, options) => {
        parseCalls += 1;
        return parseChunk(source, options);
      },
    });
    stream.tick();
    expect(parseCalls).toBe(1);
    expect(stream.loaded).toBe(1);
  });

  it("rejects a negative per-tick budget", () => {
    expect(() => createChunkStream([], { budgetBytesPerTick: -1 })).toThrow(/budgetBytesPerTick/);
  });

  it("tracks uploaded and pending bytes across ticks", () => {
    const stream = createChunkStream([quadChunk(1, 0, 0), quadChunk(2, 1, 0), quadChunk(3, 2, 0)], {
      budgetBytesPerTick: QUAD_BYTES * 2,
    });
    expect(stream.uploadedBytes).toBe(0);
    expect(stream.pendingBytes).toBe(QUAD_BYTES * 3);
    stream.tick();
    expect(stream.uploadedBytes).toBe(QUAD_BYTES * 2);
    expect(stream.pendingBytes).toBe(QUAD_BYTES);
  });
});
