import type { Viewport } from "../../src/entries/root";
import { createResultField } from "../../src/entries/results";

/** Installs two authored result rows over one reusable browser-host part. */
export function runOccurrenceResults(
  current: Viewport,
  setStatus: (result: string, message: string, detail?: string) => void,
): void {
  const scalar = (id: string, value: number) =>
    createResultField({
      id,
      name: id,
      location: "elemental",
      shape: "scalar",
      count: 2,
      unit: "unitless",
      values: new Float32Array([NaN, value]),
    });
  const displacement = (id: string, top: number) =>
    createResultField({
      id,
      name: id,
      location: "nodal",
      shape: "vector",
      count: 3,
      unit: "unitless",
      values: new Float32Array([0, 0, 0, 0, 0, 0, 0, top, 0]),
    });
  current.results.set({
    scalar: { field: scalar("shared-scalar", 0), range: { min: 0, max: 1 } },
    deformation: { field: displacement("shared-deformation", 0) },
    occurrences: [
      {
        partOccurrenceId: "1/1",
        scalar: { field: scalar("right-scalar", 1), range: { min: 0, max: 1 } },
        deformation: { field: displacement("right-deformation", 0.4) },
      },
    ],
  });
  current.render();
  const active = current.results.state;
  setStatus(
    "occurrence-results",
    JSON.stringify({
      parts: current.scene.parts.size,
      batches: current.stats().drawBatches,
      shared: active?.deformation?.displacements.has(1) === true,
      override: active?.deformation?.displacements.has("1/1") === true,
    }),
  );
}
