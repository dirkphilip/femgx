import { describe, expect, it } from "vitest";
import {
  parseTet4Cells,
  parseTet4CellsQuery,
  TET4_DENSE_MAX_CELLS,
} from "../../../demo/benchmark/dense-tet4";
import { denseTet4BenchmarkSpec } from "../../../demo/benchmark/model";
import { createBoltedPlatePreset } from "../../../demo/fixtures/presets";
import {
  createWorkbenchModelCatalog,
  meshTet4ForOwner,
} from "../../../demo/workbench/controllers/controller-catalog";
import { createExampleModel, isWorkerBenchmarkSpec } from "../../../demo/workbench/models/model";

describe("on-demand Tet4 meshing", () => {
  it("parses the supported cell range and ignores invalid values", () => {
    expect(parseTet4Cells("26")).toBe(26);
    expect(parseTet4CellsQuery("?tet4=2&other=1")).toBe(2);
    expect(parseTet4Cells("")).toBeUndefined();
    expect(parseTet4CellsQuery("?tet4=0")).toBeUndefined();
    expect(parseTet4CellsQuery(`?tet4=${TET4_DENSE_MAX_CELLS + 1}`)).toBeUndefined();
    expect(parseTet4CellsQuery(`?tet4=${TET4_DENSE_MAX_CELLS}`)).toBe(TET4_DENSE_MAX_CELLS);
    expect(parseTet4CellsQuery("?tet4=abc")).toBeUndefined();
  });

  it("creates a bounded dense-worker specification", () => {
    const spec = denseTet4BenchmarkSpec(2);
    expect(spec.id).toBe("fe-tet4-dense-2");
    expect(spec.gridCells).toBe(2);
    expect(spec.name).toContain("48 authored elements · 48 submitted exterior triangles");
    expect(isWorkerBenchmarkSpec(spec)).toBe(true);
  });

  it("enters Performance Lab and selects a parameterized case", () => {
    const catalog = createWorkbenchModelCatalog([createExampleModel(createBoltedPlatePreset())]);
    const selected: string[] = [];
    const owner = {
      catalog,
      modelSession: {
        cancel(): void {},
        setModel(id: string): void {
          selected.push(id);
        },
      },
      models: catalog.models,
      render(): void {},
    };

    meshTet4ForOwner(owner, 2);
    expect(catalog.mode).toBe("performance");
    expect(catalog.selectedId).toBe("fe-tet4-dense-2");
    expect(owner.models.some((model) => model.id === "fe-tet4-dense-2")).toBe(true);
    expect(selected).toEqual(["fe-tet4-dense-2"]);

    meshTet4ForOwner(owner, 16);
    expect(catalog.selectedId).toBe("fe-tet4-dense-16");
    meshTet4ForOwner(owner, 0);
    expect(catalog.selectedId).toBe("fe-tet4-dense-16");
  });
});
