import { readFileSync } from "node:fs";
import { Accessor } from "@gltf-transform/core";
import { describe, expect, it, vi } from "vitest";
import { createSceneRuntime } from "../../../src/scene-runtime/public-runtime";
import type { IoError } from "../../../src/io/diagnostics";
import { importGlb } from "../../../src/io/glb/importer";

const ONShapeCylinder = readFileSync(
  new URL("../fixtures/glb/onshape-cylinder-uncompressed.glb", import.meta.url),
);
const compressedOnshapeCylinder = readFileSync(
  new URL("../fixtures/glb/onshape-cylinder-compressed.glb", import.meta.url),
);

describe("importGlb", () => {
  it("imports the supplied uncompressed Onshape display scene", async () => {
    const result = await importGlb(ONShapeCylinder);

    expect(result.scene.rootAssemblyId).toBe(0);
    expect(result.scene.parts).toHaveLength(1);
    expect(result.scene.assemblies).toHaveLength(2);
    expect(result.scene.assemblies.get(0)?.placements).toHaveLength(1);
    expect(result.scene.assemblies.get(1)?.placements).toHaveLength(1);
    expect([...result.partNames.values()]).toEqual(["mesh0_mesh (4 primitives)"]);
    expect(result.partStyles.get(0)).toEqual({
      color: { r: 0.615686297416687, g: 0.8117647171020508, b: 0.929411768913269, a: 1 },
    });
    expect(result.issues).toEqual([
      expect.objectContaining({ code: "glb-ignored-extension", severity: "warning" }),
    ]);
  });

  it("imports the supplied Draco-compressed Onshape display scene", async () => {
    const result = await importGlb(compressedOnshapeCylinder);

    expect(result.scene.parts).toHaveLength(1);
    expect(result.scene.assemblies.get(1)?.placements).toHaveLength(1);
    expect(
      [...result.scene.parts.values()].map((part) => part.geometries[0]?.indices.length),
    ).toEqual([684]);
    expect(result.issues).toEqual([
      expect.objectContaining({ code: "glb-ignored-extension", severity: "warning" }),
    ]);
  });

  it("copies packed accessors without per-element accessor calls", async () => {
    const elementSpy = vi.spyOn(Accessor.prototype, "getElement");
    const scalarSpy = vi.spyOn(Accessor.prototype, "getScalar");

    const result = await importGlb(makeTriangleGlb("u32"));

    expect(result.scene.parts.get(0)?.geometries[0]?.positions).toEqual(
      new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    );
    expect(result.scene.parts.get(0)?.geometries[0]?.indices).toEqual(new Uint32Array([0, 1, 2]));
    expect(elementSpy).not.toHaveBeenCalled();
    expect(scalarSpy).not.toHaveBeenCalled();
  });

  it("coalesces same-material primitives before entering the scene", async () => {
    const result = await importGlb(makeSharedAccessorPrimitiveGlb(128, false));

    expect(result.scene.parts).toHaveLength(1);
    expect(result.scene.parts.get(0)?.geometries[0]?.positions).toHaveLength(9);
    expect(result.scene.parts.get(0)?.geometries[0]?.indices).toHaveLength(128 * 3);
    expect(result.partNames.get(0)).toBe("Shared mesh (128 primitives)");
  });

  it("reuses one validated POSITION array across material groups", async () => {
    const result = await importGlb(makeSharedAccessorPrimitiveGlb(2, true));
    const first = result.scene.parts.get(0)?.geometries[0]?.positions;
    const second = result.scene.parts.get(1)?.geometries[0]?.positions;

    expect(result.scene.parts).toHaveLength(2);
    expect(first).toBe(second);
  });

  it("reuses imported parts through the canonical runtime", async () => {
    const result = await importGlb(ONShapeCylinder);
    const runtime = createSceneRuntime(result.scene);

    expect(runtime.partOccurrenceCount).toBe(1);
    expect(runtime.visibleCount).toBe(1);
    expect(runtime.getPartOccurrences().map((instance) => instance.partId)).toEqual([0]);
  });

  it("allocates deterministic ids and rejects strict ignored-feature diagnostics", async () => {
    const first = await importGlb(ONShapeCylinder);
    const second = await importGlb(ONShapeCylinder);
    expect([...first.scene.parts.keys()]).toEqual([...second.scene.parts.keys()]);
    expect([...first.partNames.entries()]).toEqual([...second.partNames.entries()]);

    await expect(importGlb(ONShapeCylinder, { strict: true })).rejects.toMatchObject({
      name: "IoError",
      issues: [expect.objectContaining({ code: "glb-ignored-extension" })],
    } satisfies Partial<IoError>);
  });

  it("rejects invalid GLB headers with a stable issue", async () => {
    const invalid = new Uint8Array(ONShapeCylinder);
    invalid[0] = 0;

    await expect(importGlb(invalid)).rejects.toMatchObject({
      name: "IoError",
      issues: [expect.objectContaining({ code: "glb-invalid-header" })],
    });
  });

  it("rejects unsupported required extensions before producing a partial scene", async () => {
    const invalid = new Uint8Array(ONShapeCylinder);
    const jsonLength = new DataView(invalid.buffer).getUint32(12, true);
    const json = JSON.parse(new TextDecoder().decode(invalid.subarray(20, 20 + jsonLength))) as {
      extensionsRequired?: string[];
    };
    json.extensionsRequired = ["EXT_unknown_required_extension"];
    const encoded = new TextEncoder().encode(JSON.stringify(json).padEnd(jsonLength, " "));
    invalid.set(encoded.subarray(0, jsonLength), 20);

    await expect(importGlb(invalid)).rejects.toMatchObject({
      name: "IoError",
      issues: [expect.objectContaining({ code: "glb-unsupported-required-extension" })],
    });
  });

  it.each(["u8", "u16", "u32"] as const)(
    "promotes %s indices and supports non-indexed triangles",
    async (indexKind) => {
      const indexed = await importGlb(makeTriangleGlb(indexKind));
      expect(indexed.scene.parts.get(0)?.geometries[0]?.indices).toEqual(
        new Uint32Array([0, 1, 2]),
      );

      const nonIndexed = await importGlb(makeTriangleGlb("none"));
      expect(nonIndexed.scene.parts.get(0)?.geometries[0]?.indices).toEqual(
        new Uint32Array([0, 1, 2]),
      );
    },
  );

  it("preserves mesh reuse, nested transforms, and ignores unreachable nodes", async () => {
    const result = await importGlb(makeRepeatedMeshGlb());
    expect(result.scene.parts).toHaveLength(1);
    expect(result.scene.assemblies).toHaveLength(4);
    expect(result.scene.assemblies.get(1)?.placements).toHaveLength(2);
    expect(result.scene.assemblies.get(2)?.placements).toHaveLength(1);
    expect(result.scene.assemblies.get(3)?.placements).toHaveLength(1);
    expect(createSceneRuntime(result.scene).partOccurrenceCount).toBe(3);
    expect([...(result.scene.assemblies.get(0)?.placements[0]?.transform ?? [])]).toEqual([
      1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 2, 3, 1,
    ]);
  });

  it("maps opaque, blended, and masked material alpha deterministically", async () => {
    const opaque = await importGlb(makeTriangleGlb("none", { alphaMode: "OPAQUE", alpha: 0.2 }));
    const blended = await importGlb(makeTriangleGlb("none", { alphaMode: "BLEND", alpha: 0.2 }));
    const masked = await importGlb(makeTriangleGlb("none", { alphaMode: "MASK", alpha: 0.2 }));
    expect(opaque.partStyles.get(0)?.color?.a).toBe(1);
    expect(blended.partStyles.get(0)?.color?.a).toBe(0.2);
    expect(masked.partStyles.get(0)?.color?.a).toBe(0);
    expect(masked.issues).toEqual([
      expect.objectContaining({ code: "glb-mask-alpha-approximation" }),
    ]);
  });
});

type IndexKind = "none" | "u8" | "u16" | "u32";

interface MaterialOptions {
  readonly alphaMode: "OPAQUE" | "BLEND" | "MASK";
  readonly alpha: number;
}

function makeTriangleGlb(indexKind: IndexKind, materialOptions?: MaterialOptions): Uint8Array {
  const positionBytes = bytesOf(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]));
  const indexBytes = indexBytesFor(indexKind);
  const binary = concat(positionBytes, indexBytes);
  const accessors = [
    { bufferView: 0, componentType: 5126, count: 3, type: "VEC3" },
    ...(indexKind === "none"
      ? []
      : [{ bufferView: 1, componentType: componentTypeFor(indexKind), count: 3, type: "SCALAR" }]),
  ];
  const primitive = {
    attributes: { POSITION: 0 },
    ...(indexKind === "none" ? {} : { indices: 1 }),
    material: 0,
  };
  const alpha = materialOptions?.alpha ?? 1;
  const json = {
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ name: "Triangle scene", nodes: [0] }],
    nodes: [{ name: "Triangle node", mesh: 0 }],
    meshes: [{ name: "Triangle mesh", primitives: [primitive] }],
    materials: [
      {
        name: "Triangle material",
        alphaMode: materialOptions?.alphaMode ?? "OPAQUE",
        pbrMetallicRoughness: { baseColorFactor: [0.2, 0.4, 0.6, alpha] },
      },
    ],
    buffers: [{ byteLength: binary.byteLength }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positionBytes.byteLength },
      ...(indexKind === "none"
        ? []
        : [{ buffer: 0, byteOffset: positionBytes.byteLength, byteLength: indexBytes.byteLength }]),
    ],
    accessors,
  };
  return makeGlb(json, binary);
}

function makeRepeatedMeshGlb(): Uint8Array {
  const positionBytes = bytesOf(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]));
  const indexBytes = bytesOf(new Uint16Array([0, 1, 2]));
  const binary = concat(positionBytes, indexBytes);
  return makeGlb(
    {
      asset: { version: "2.0" },
      scene: 0,
      scenes: [{ name: "Nested", nodes: [0, 2] }],
      nodes: [
        { name: "Parent", mesh: 0, children: [1], translation: [1, 2, 3] },
        { name: "Nested child", mesh: 0, rotation: [0, 0, 0.7071068, 0.7071068], scale: [2, 3, 4] },
        { name: "Second occurrence", mesh: 0 },
        { name: "Unreachable", mesh: 0 },
      ],
      meshes: [
        {
          name: "Reusable mesh",
          primitives: [{ attributes: { POSITION: 0 }, indices: 1 }],
        },
      ],
      buffers: [{ byteLength: binary.byteLength }],
      bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: positionBytes.byteLength },
        { buffer: 0, byteOffset: positionBytes.byteLength, byteLength: indexBytes.byteLength },
      ],
      accessors: [
        { bufferView: 0, componentType: 5126, count: 3, type: "VEC3" },
        { bufferView: 1, componentType: 5123, count: 3, type: "SCALAR" },
      ],
    },
    binary,
  );
}

function makeSharedAccessorPrimitiveGlb(
  primitiveCount: number,
  distinctMaterials: boolean,
): Uint8Array {
  const positionBytes = bytesOf(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]));
  const indexBytes = bytesOf(new Uint32Array([0, 1, 2]));
  const binary = concat(positionBytes, indexBytes);
  const materials = distinctMaterials
    ? Array.from({ length: primitiveCount }, (_, index) => ({
        name: `Material ${index}`,
        pbrMetallicRoughness: { baseColorFactor: [index / primitiveCount, 0.4, 0.6, 1] },
      }))
    : undefined;
  return makeGlb(
    {
      asset: { version: "2.0" },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0 }],
      meshes: [
        {
          name: "Shared mesh",
          primitives: Array.from({ length: primitiveCount }, (_, index) => ({
            attributes: { POSITION: 0 },
            indices: 1,
            ...(distinctMaterials ? { material: index } : {}),
          })),
        },
      ],
      ...(materials === undefined ? {} : { materials }),
      buffers: [{ byteLength: binary.byteLength }],
      bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: positionBytes.byteLength },
        { buffer: 0, byteOffset: positionBytes.byteLength, byteLength: indexBytes.byteLength },
      ],
      accessors: [
        { bufferView: 0, componentType: 5126, count: 3, type: "VEC3" },
        { bufferView: 1, componentType: 5125, count: 3, type: "SCALAR" },
      ],
    },
    binary,
  );
}

function componentTypeFor(indexKind: Exclude<IndexKind, "none">): number {
  return indexKind === "u8" ? 5121 : indexKind === "u16" ? 5123 : 5125;
}

function indexBytesFor(indexKind: IndexKind): Uint8Array {
  if (indexKind === "none") return new Uint8Array();
  if (indexKind === "u8") return bytesOf(new Uint8Array([0, 1, 2]));
  if (indexKind === "u16") return bytesOf(new Uint16Array([0, 1, 2]));
  return bytesOf(new Uint32Array([0, 1, 2]));
}

function bytesOf(values: Uint8Array | Uint16Array | Uint32Array | Float32Array): Uint8Array {
  return new Uint8Array(values.buffer, values.byteOffset, values.byteLength);
}

function concat(left: Uint8Array, right: Uint8Array): Uint8Array {
  const result = new Uint8Array(left.byteLength + right.byteLength);
  result.set(left, 0);
  result.set(right, left.byteLength);
  return result;
}

function makeGlb(json: object, binary: Uint8Array): Uint8Array {
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const paddedJsonLength = (jsonBytes.byteLength + 3) & ~3;
  const paddedBinaryLength = (binary.byteLength + 3) & ~3;
  const totalLength = 12 + 8 + paddedJsonLength + 8 + paddedBinaryLength;
  const result = new Uint8Array(totalLength);
  const view = new DataView(result.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, totalLength, true);
  view.setUint32(12, paddedJsonLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  result.set(jsonBytes, 20);
  result.fill(0x20, 20 + jsonBytes.byteLength, 20 + paddedJsonLength);
  const binaryHeader = 20 + paddedJsonLength;
  view.setUint32(binaryHeader, paddedBinaryLength, true);
  view.setUint32(binaryHeader + 4, 0x004e4942, true);
  result.set(binary, binaryHeader + 8);
  return result;
}
