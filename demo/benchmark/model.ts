import { createPart, type Part } from "../../src/geometry/part";
import { translation } from "../../src/math/mat4";
import { createScene, type Scene } from "../../src/scene/scene";
import { createStructuredFePart, type StructuredFeFamily } from "./structured-fe";
import {
  createPlanarGridGeometry,
  type PlanarGridElementFamily,
  type PlanarGridOptions,
} from "../fixture/planar-grid";
import { createPerformancePreset } from "../fixture/performance-fixture";
export { estimateBenchmarkMemory, type BenchmarkMemoryEstimate } from "./memory";

const ROOT_ASSEMBLY_ID = 1;

export type WebGpuBenchmarkKind =
  | "instancing-heavy"
  | "unique-geometry"
  | "many-parts"
  | "placement-heavy"
  | "body-heavy"
  | "structured-fe";

export type WebGpuBenchmarkElementFamily = PlanarGridElementFamily | StructuredFeFamily;

export interface WebGpuBenchmarkSpec {
  readonly id: string;
  readonly name: string;
  readonly kind: WebGpuBenchmarkKind;
  readonly gridCells: number;
  readonly partCount: number;
  readonly instanceCount: number;
  readonly bodyCount: number;
  readonly elementFamily: WebGpuBenchmarkElementFamily;
  readonly structuredFamily?: StructuredFeFamily;
  /** Whether this case is safe for the ordinary interactive workbench. */
  readonly ordinaryDemo?: boolean;
}

export interface WebGpuBenchmarkCase {
  readonly id: WebGpuBenchmarkSpec["id"];
  readonly name: WebGpuBenchmarkSpec["name"];
  readonly kind: WebGpuBenchmarkKind;
  readonly scene: Scene;
  readonly gridCells: number;
  readonly partCount: number;
  readonly instanceCount: number;
  readonly bodyCount: number;
  readonly elementFamily: WebGpuBenchmarkElementFamily;
  readonly structuredFamily?: StructuredFeFamily;
}

/** Returns the fixed benchmark matrix, optionally including the larger local case. */
export function benchmarkCaseSpecs(includeLarge: boolean): readonly WebGpuBenchmarkSpec[] {
  return [
    {
      id: "instanced-2.10m",
      name: "Performance Lab · 32,768 unique Quad elements · 2,097,152 submitted triangles",
      kind: "instancing-heavy",
      gridCells: 128,
      partCount: 1,
      instanceCount: 64,
      bodyCount: 0,
      elementFamily: "quad",
      ordinaryDemo: false,
    },
    {
      id: "unique-250k",
      name: "Performance Lab · 250,632 unique Triangle elements · 250,632 submitted triangles",
      kind: "unique-geometry",
      gridCells: 354,
      partCount: 1,
      instanceCount: 1,
      bodyCount: 0,
      elementFamily: "triangle",
      ordinaryDemo: false,
    },
    {
      id: "unique-1m",
      name: "Performance Lab · 999,698 unique Triangle elements · 999,698 submitted triangles",
      kind: "unique-geometry",
      gridCells: 707,
      partCount: 1,
      instanceCount: 1,
      bodyCount: 0,
      elementFamily: "triangle",
      ordinaryDemo: false,
    },
    {
      id: "many-parts-100",
      name: "Performance Lab · 1,008,200 unique/submitted Triangle elements · 100 parts",
      kind: "many-parts",
      gridCells: 71,
      partCount: 100,
      instanceCount: 100,
      bodyCount: 0,
      elementFamily: "triangle",
      ordinaryDemo: false,
    },
    {
      id: "many-parts-1000",
      name: "Performance Lab · 968,000 unique/submitted Triangle elements · 1,000 parts",
      kind: "many-parts",
      gridCells: 22,
      partCount: 1_000,
      instanceCount: 1_000,
      bodyCount: 0,
      elementFamily: "triangle",
      ordinaryDemo: false,
    },
    {
      id: "placements-10k",
      name: "Performance Lab · 64 unique Quad elements · 640,000 submitted occurrences",
      kind: "placement-heavy",
      gridCells: 8,
      partCount: 1,
      instanceCount: 10_000,
      bodyCount: 0,
      elementFamily: "quad",
      ordinaryDemo: false,
    },
    {
      id: "bodies-256",
      name: "Performance Lab · 1,024 unique/submitted Quad elements · 256 bodies",
      kind: "body-heavy",
      gridCells: 32,
      partCount: 1,
      instanceCount: 1,
      bodyCount: 256,
      elementFamily: "quad",
      ordinaryDemo: true,
    },
    {
      id: "fe-quad-shell-visual",
      name: "Performance Lab · FE Quad shell · 576 unique/submitted elements · 1,152 triangles",
      kind: "structured-fe",
      gridCells: 24,
      partCount: 1,
      instanceCount: 1,
      bodyCount: 1,
      elementFamily: "quad",
      structuredFamily: "quad",
      ordinaryDemo: true,
    },
    {
      id: "fe-quad8-shell-visual",
      name: "Performance Lab · FE Quad8 shell · 256 unique/submitted elements · 1,536 triangles",
      kind: "structured-fe",
      gridCells: 16,
      partCount: 1,
      instanceCount: 1,
      bodyCount: 1,
      elementFamily: "quad8",
      structuredFamily: "quad8",
      ordinaryDemo: true,
    },
    {
      id: "fe-hex8-solid-visual",
      name: "Performance Lab · FE Hex8 solid · 512 unique/submitted elements · 768 triangles",
      kind: "structured-fe",
      gridCells: 8,
      partCount: 1,
      instanceCount: 1,
      bodyCount: 1,
      elementFamily: "hex8",
      structuredFamily: "hex8",
      ordinaryDemo: true,
    },
    {
      id: "fe-hex20-solid-visual",
      name: "Performance Lab · FE Hex20 solid · 216 unique/submitted elements · 1,296 triangles",
      kind: "structured-fe",
      gridCells: 6,
      partCount: 1,
      instanceCount: 1,
      bodyCount: 1,
      elementFamily: "hex20",
      structuredFamily: "hex20",
      ordinaryDemo: true,
    },
    ...(includeLarge
      ? [
          {
            id: "fe-hex20-solid-local",
            name: "Performance Lab · FE Hex20 solid · 1,728 unique/submitted elements · 10,368 triangles (local)",
            kind: "structured-fe" as const,
            gridCells: 12,
            partCount: 1,
            instanceCount: 1,
            bodyCount: 1,
            elementFamily: "hex20" as const,
            structuredFamily: "hex20" as const,
            ordinaryDemo: false,
          },
          {
            id: "unique-2m-local",
            name: "Performance Lab · 2,000,000 unique/submitted Triangle elements · 2,000,000 triangles (local)",
            kind: "unique-geometry" as const,
            gridCells: 1_000,
            partCount: 1,
            instanceCount: 1,
            bodyCount: 0,
            elementFamily: "triangle" as const,
            ordinaryDemo: false,
          },
        ]
      : []),
  ];
}

/** Returns benchmark models allowed in the workbench's ordinary selector. */
export function workbenchBenchmarkSpecs(performanceLab: boolean): readonly WebGpuBenchmarkSpec[] {
  return benchmarkCaseSpecs(performanceLab).filter(
    (spec) => performanceLab || spec.ordinaryDemo === true,
  );
}

/** Builds one deterministic benchmark scene without including generation in its timings. */
export function createBenchmarkCase(spec: WebGpuBenchmarkSpec): WebGpuBenchmarkCase {
  if (spec.kind === "instancing-heavy") {
    return { ...spec, scene: createPerformancePreset().scene };
  }
  const parts =
    spec.kind === "structured-fe"
      ? [createStructuredFePart(1, structuredFamily(spec), spec.gridCells)]
      : createBenchmarkParts(spec);
  const placements = createPlacements(spec, parts);
  let builder = createScene();
  for (const part of parts) builder = builder.addPart(part);
  const scene = builder
    .addAssembly({ id: ROOT_ASSEMBLY_ID, name: spec.id, placements })
    .withRoot(ROOT_ASSEMBLY_ID)
    .build();
  return { ...spec, scene };
}

function structuredFamily(spec: WebGpuBenchmarkSpec): StructuredFeFamily {
  if (spec.structuredFamily === undefined) {
    throw new Error(`${spec.id} requires a structured FE family`);
  }
  return spec.structuredFamily;
}

function createBenchmarkParts(spec: WebGpuBenchmarkSpec): Part[] {
  const withFaces = spec.kind === "body-heavy";
  const elementFamily = planarElementFamily(spec);
  return Array.from({ length: spec.partCount }, (_, index) => {
    const bodyCount = index === 0 && spec.bodyCount > 0 ? spec.bodyCount : undefined;
    const options =
      bodyCount === undefined
        ? { withFaces, elementFamily }
        : { withFaces, bodyCount, elementFamily };
    return createPart(index + 1, createPlanarGridGeometry(spec.gridCells, options));
  });
}

function planarElementFamily(spec: WebGpuBenchmarkSpec): PlanarGridOptions["elementFamily"] {
  if (spec.elementFamily === "triangle" || spec.elementFamily === "quad") {
    return spec.elementFamily;
  }
  throw new Error(`${spec.id} requires a structured FE builder for ${spec.elementFamily}`);
}

function createPlacements(
  spec: WebGpuBenchmarkSpec,
  parts: readonly Part[],
): { readonly kind: "part"; readonly partId: number; readonly transform: Float32Array }[] {
  if (spec.kind === "placement-heavy") {
    return Array.from({ length: spec.instanceCount }, (_, index) => ({
      kind: "part" as const,
      partId: parts[0]?.id ?? 1,
      transform: translation((index % 100) * 1.2, Math.floor(index / 100) * 1.2, 0),
    }));
  }
  return parts.map((part, index) => ({
    kind: "part" as const,
    partId: part.id,
    transform: translation((index % 32) * 1.2, Math.floor(index / 32) * 1.2, 0),
  }));
}
