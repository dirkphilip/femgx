import { describe, expect, it } from "vitest";
import { createCamera, viewProjectionMatrix } from "../../src/camera/camera";
import type { ChunkSource } from "../../src/streaming/chunk";
import { buildSpatialGrid, cullChunks } from "../../src/streaming/spatial";
import { quadChunk } from "./fixtures";

const viewProjection = viewProjectionMatrix(createCamera());

describe("buildSpatialGrid", () => {
  it("partitions chunks by their bounds center", () => {
    const chunks = [quadChunk(1, 0, 0), quadChunk(2, 1, 10), quadChunk(3, 2, 0)];
    const grid = buildSpatialGrid(chunks, 4);
    expect(grid.cells).toHaveLength(2);
    expect(grid.cells[0]?.chunkIds).toEqual([1, 3]);
    expect(grid.cells[1]?.chunkIds).toEqual([2]);
  });

  it("stores cells in deterministic ascending order", () => {
    const chunks = [quadChunk(1, 0, 10), quadChunk(2, 1, 0), quadChunk(3, 2, -5)];
    const grid = buildSpatialGrid(chunks, 4);
    expect(grid.cells.map((cell) => cell.x)).toEqual([-2, 0, 2]);
  });

  it("rejects a non-positive cell size", () => {
    expect(() => buildSpatialGrid([], 0)).toThrow(/cellSize/);
  });

  it("computes bounds from data for chunks without precomputed bounds", () => {
    const dataOnly: ChunkSource = { chunkId: 1, index: 0, data: quadChunk(1, 0, 0).data };
    const grid = buildSpatialGrid([dataOnly], 4);
    expect(grid.cells[0]?.chunkIds).toEqual([1]);
  });
});

describe("cullChunks", () => {
  it("returns visible chunks in deterministic model order", () => {
    const chunks = [quadChunk(2, 0, 0), quadChunk(1, 1, 0)];
    const grid = buildSpatialGrid(chunks, 4);
    expect(cullChunks(grid, viewProjection).map((chunk) => chunk.chunkId)).toEqual([2, 1]);
  });

  it("excludes chunks far outside the frustum", () => {
    const chunks = [quadChunk(1, 0, 0), quadChunk(2, 1, 1_000_000)];
    const grid = buildSpatialGrid(chunks, 100_000);
    expect(cullChunks(grid, viewProjection).map((chunk) => chunk.chunkId)).toEqual([1]);
  });

  it("rejects whole off-screen cells at once", () => {
    const chunks = [
      quadChunk(1, 0, 0),
      quadChunk(2, 1, 1_000_000),
      quadChunk(3, 2, 1_000_010),
      quadChunk(4, 3, 1_000_020),
    ];
    const grid = buildSpatialGrid(chunks, 100_000);
    expect(cullChunks(grid, viewProjection).map((chunk) => chunk.chunkId)).toEqual([1]);
  });

  it("computes bounds from data when the grid is built from data-only chunks", () => {
    const dataOnly = [quadChunk(1, 0, 0), quadChunk(2, 1, 1_000_000)];
    const grid = buildSpatialGrid(dataOnly, 100_000);
    expect(cullChunks(grid, viewProjection).map((chunk) => chunk.chunkId)).toEqual([1]);
  });
});
