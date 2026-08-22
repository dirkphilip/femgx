import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createPackedSceneRuntime } from "@/scene-runtime/runtime";
import {
  createPartRevisionResultResolutionView,
  createResultResolutionView,
} from "@/viewport/results/resolution-view";
import { createPart, createSceneBuilder, createTestScene, identityMatrix } from "./support";

const revisionScope = fileURLToPath(
  new URL("../../../src/viewport/results/revision-scope.ts", import.meta.url),
);

describe("part revision result scope", () => {
  it("does not impersonate a full runtime with a proxy", () => {
    const source = readFileSync(revisionScope, "utf8");

    expect(source).not.toContain("PackedSceneRuntime");
    expect(source).not.toContain("partRevisionRuntime");
    expect(source).not.toContain("Proxy");
  });

  it("keeps revised occurrence identities independent of packed slots", () => {
    const firstPart = createTestScene().parts.get(1);
    if (firstPart === undefined) throw new Error("Test part is missing");
    const secondPart = createPart(2, {
      geometries: [
        {
          primitive: "triangles",
          positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
          indices: new Uint32Array([0, 1, 2]),
        },
      ],
    });
    const scene = createSceneBuilder()
      .addPart(firstPart)
      .addPart(secondPart)
      .addAssembly({
        id: 1,
        name: "scoped-results",
        placements: [
          { kind: "part", placementId: "retained", partId: 2, transform: identityMatrix() },
          { kind: "part", placementId: "first", partId: 1, transform: identityMatrix() },
          { kind: "part", placementId: "second", partId: 1, transform: identityMatrix() },
        ],
      })
      .setRootAssembly(1)
      .build();
    const full = createResultResolutionView(createPackedSceneRuntime(scene));
    const revised = createPartRevisionResultResolutionView(full, new Set([1]));

    expect([...full.renderedPartIds]).toEqual([2, 1]);
    expect([...revised.renderedPartIds]).toEqual([1]);
    expect(revised.occurrencesForPart(1)).toEqual(["1/first", "1/second"]);
    expect(revised.partIdForOccurrence("1/retained")).toBeUndefined();
    expect(revised.partIdForOccurrence("1/first")).toBe(1);
  });
});
