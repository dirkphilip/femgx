import { describe, expect, it } from "vitest";
import { createCamera, viewProjectionMatrix } from "../../src/camera/camera";
import type { ChunkSource } from "../../src/streaming/chunk";
import { buildSpatialGrid, cullChunks, detailIndexForDistance } from "../../src/streaming/spatial";
import { lodLineChunk, quadChunk } from "./fixtures";

const viewProjection = viewProjectionMatrix(createCamera());

const lodViewProjection = viewProjectionMatrix(
  createCamera({
    position: [0, 0, 0],
    target: [150_000, 0, 0],
    far: 500_000,
    fovY: Math.PI / 1.5,
  }),
);

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

  it("partitions LOD chunks by their finest-detail bounds center", () => {
    const chunks = [lodLineChunk(1, 0, 0), lodLineChunk(2, 1, 10)];
    const grid = buildSpatialGrid(chunks, 4);
    expect(grid.cells).toHaveLength(2);
    expect(grid.cells[0]?.chunkIds).toEqual([1]);
    expect(grid.cells[1]?.chunkIds).toEqual([2]);
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

describe("detailIndexForDistance", () => {
  it("selects the finest detail below the first threshold", () => {
    expect(detailIndexForDistance(5, [10, 100])).toBe(0);
  });

  it("steps one level per crossed threshold", () => {
    expect(detailIndexForDistance(50, [10, 100])).toBe(1);
    expect(detailIndexForDistance(500, [10, 100])).toBe(2);
  });

  it("treats an empty threshold list as always finest", () => {
    expect(detailIndexForDistance(500, [])).toBe(0);
  });
});

describe("cullChunks LOD", () => {
  it("resolves LOD chunks to their finest detail by default", () => {
    const chunks = [lodLineChunk(1, 0, 0, [4, 2]), quadChunk(2, 1, 0)];
    const grid = buildSpatialGrid(chunks, 4);
    const result = cullChunks(grid, viewProjection);
    const lod = result.find((chunk) => chunk.chunkId === 1);
    expect(lod?.data.indices).toHaveLength(4);
    expect(result.map((chunk) => chunk.chunkId)).toEqual([1, 2]);
  });

  it("selects a coarser detail for cells far from the camera", () => {
    const chunks = [lodLineChunk(1, 0, 0, [4, 2]), lodLineChunk(2, 1, 100_000, [4, 2])];
    const grid = buildSpatialGrid(chunks, 50_000);
    const result = cullChunks(grid, lodViewProjection, {
      cameraPosition: [0, 0, 0],
      detailThresholds: [50_000],
    });
    const near = result.find((chunk) => chunk.chunkId === 1);
    const far = result.find((chunk) => chunk.chunkId === 2);
    expect(near?.data.indices).toHaveLength(4);
    expect(far?.data.indices).toHaveLength(2);
    expect(result.map((chunk) => chunk.chunkId)).toEqual([1, 2]);
  });

  it("keeps plain chunks unchanged when detail selection is active", () => {
    const chunks = [quadChunk(1, 0, 0), lodLineChunk(2, 1, 100_000, [4, 2])];
    const grid = buildSpatialGrid(chunks, 50_000);
    const result = cullChunks(grid, lodViewProjection, {
      cameraPosition: [0, 0, 0],
      detailThresholds: [50_000],
    });
    const plain = result.find((chunk) => chunk.chunkId === 1);
    const lod = result.find((chunk) => chunk.chunkId === 2);
    expect(plain?.data.indices).toHaveLength(6);
    expect(lod?.data.indices).toHaveLength(2);
  });
});
