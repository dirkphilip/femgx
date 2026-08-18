import { Logger, WebIO } from "@gltf-transform/core";
import type { JSONDocument, Mesh, Node, Scene as GltfScene } from "@gltf-transform/core";
import { KHRDracoMeshCompression } from "@gltf-transform/extensions";
import draco3d, { type DracoDecoderOptions } from "draco3dgltf";
import dracoDecoderWasmUrl from "../../../node_modules/draco3dgltf/draco_decoder_gltf.wasm?url";
import { createScene, type Scene } from "../../scene/scene";
import type { AssemblyDefinition, Placement } from "../../scene/assembly";
import { identity, type Mat4 } from "../../math/mat4";
import type { PartId } from "../../geometry/part";
import type { StyleOverride } from "../../interaction/state";
import { IoError } from "../diagnostics";
import { GlbDiagnostics, parseFailure } from "./diagnostics";
import { importMeshParts, type GlbPartRecord } from "./geometry";
import type { GlbImportOptions, GlbSceneImport } from "./types";

export type { GlbImportOptions, GlbIssueCode, GlbSceneImport } from "./types";

const GLB_MAGIC = 0x46546c67;
const GLB_VERSION = 2;
const HEADER_BYTES = 12;
const KHR_DRACO_MESH_COMPRESSION = "KHR_draco_mesh_compression";

/**
 * Imports a browser-safe GLB 2.0 display scene into femgx's canonical
 * {@link root.Scene}.
 *
 * The input is self-contained GLB bytes. The selected glTF scene becomes a
 * synthetic root assembly; each reachable node becomes a named assembly and
 * each supported mesh primitive becomes one reusable {@link root.Part}. Repeated
 * mesh use remains instanced geometry, while node transforms become placement
 * transforms. glTF coordinates are preserved numerically; no unit conversion
 * is applied.
 *
 * This is a display-scene importer, not FE interchange: it does not invent
 * nodes/elements/results and intentionally excludes external resources,
 * textures, PBR extras, animation, lights, and units. In strict mode a
 * recoverable warning is also rejected; otherwise inspect `issues` before
 * handing `scene` to {@link root.createViewport}.
 * @example Import self-contained bytes and render the returned scene.
 * ```ts
 * import { createViewport } from "femgx";
 * import { importGlb } from "femgx/io/glb";
 *
 * const bytes = new Uint8Array(await fetch("/model.glb").then((response) => response.arrayBuffer()));
 * const imported = await importGlb(bytes, { strict: true });
 * const viewport = await createViewport({ canvas, scene: imported.scene });
 * ```
 * @category Import and export
 */
export async function importGlb(
  source: ArrayBuffer | Uint8Array,
  options: GlbImportOptions = {},
): Promise<GlbSceneImport> {
  const diagnostics = new GlbDiagnostics(options.strict === true);
  const bytes = copyBytes(source);
  validateContainer(bytes, diagnostics);
  try {
    const io = new WebIO().setLogger(new Logger(Logger.Verbosity.SILENT));
    const jsonDocument = await io.binaryToJSON(bytes);
    validateEmbeddedResources(jsonDocument, diagnostics);
    reportExtensions(jsonDocument, diagnostics);
    if (usesDracoCompression(jsonDocument)) {
      io.registerExtensions([KHRDracoMeshCompression]).registerDependencies({
        "draco3d.decoder": await draco3d.createDecoderModule(dracoDecoderOptions()),
      });
    }
    const document = await io.readJSON(jsonDocument);
    const root = document.getRoot();
    const assetVersion = root.getAsset().version;
    if (!assetVersion.startsWith("2.")) {
      diagnostics.fatal(
        "glb-invalid-version",
        `GLB asset version ${assetVersion} is not supported.`,
      );
    }
    const scenes = root.listScenes();
    const defaultScene = root.getDefaultScene();
    const selected = defaultScene ?? scenes[0];
    if (defaultScene === null && selected !== undefined) {
      diagnostics.info(
        "glb-default-scene-fallback",
        "No default scene was declared; selected the first scene.",
      );
    }
    if (selected === undefined) {
      return diagnostics.fatal("glb-no-scene", "GLB does not contain a selectable scene.");
    }
    const result = buildScene(selected, diagnostics);
    return { ...result, issues: diagnostics.finish() };
  } catch (error) {
    if (error instanceof IoError) throw error;
    return parseFailure(diagnostics, error);
  }
}

interface BuiltScene {
  readonly scene: Scene;
  readonly partNames: ReadonlyMap<PartId, string>;
  readonly partStyles: ReadonlyMap<PartId, StyleOverride>;
}

function buildScene(selected: GltfScene, diagnostics: GlbDiagnostics): BuiltScene {
  const nodes = reachableNodes(selected, diagnostics);
  const collection = collectPartRecords(nodes, diagnostics);
  const partRecords = collection.records;
  if (partRecords.length === 0) {
    diagnostics.fatal(
      "glb-no-supported-geometry",
      "Selected GLB scene has no supported drawable triangle primitive.",
    );
  }
  const nodeIds = new Map<Node, number>();
  nodes.forEach((node, index) => nodeIds.set(node, index + 1));
  let builder = createScene();
  const partNames = new Map<PartId, string>();
  const partStyles = new Map<PartId, StyleOverride>();
  for (const record of partRecords) {
    builder = builder.addPart(record.part);
    partNames.set(record.part.id, record.name);
    partStyles.set(record.part.id, record.style);
  }
  for (const node of nodes) {
    const id = nodeIds.get(node);
    if (id === undefined) continue;
    const placements: Placement[] = [];
    const mesh = node.getMesh();
    for (const record of mesh === null ? [] : (collection.byMesh.get(mesh) ?? [])) {
      placements.push({ kind: "part", partId: record.part.id, transform: identity() });
    }
    for (const child of node.listChildren()) {
      const childId = nodeIds.get(child);
      if (childId === undefined) continue;
      placements.push({
        kind: "assembly",
        assemblyId: childId,
        transform: nodeTransform(child, diagnostics),
      });
    }
    builder = builder.addAssembly({ id, name: nodeName(node, id), placements });
  }
  const rootId = 0;
  const rootPlacements: Placement[] = selected.listChildren().flatMap((node) => {
    const id = nodeIds.get(node);
    return id === undefined
      ? []
      : [{ kind: "assembly", assemblyId: id, transform: nodeTransform(node, diagnostics) }];
  });
  const rootAssembly: AssemblyDefinition = {
    id: rootId,
    name: selected.getName().trim() || "GLB scene",
    placements: rootPlacements,
  };
  const scene = builder.addAssembly(rootAssembly).withRoot(rootId).build();
  return { scene, partNames, partStyles };
}

function reachableNodes(selected: GltfScene, diagnostics: GlbDiagnostics): readonly Node[] {
  const nodes: Node[] = [];
  const states = new Map<Node, "visiting" | "visited">();
  const visit = (node: Node): void => {
    const state = states.get(node);
    if (state === "visiting")
      diagnostics.fatal("glb-invalid-transform", "GLB node hierarchy contains a cycle.");
    if (state === "visited") return;
    states.set(node, "visiting");
    nodes.push(node);
    for (const child of node.listChildren()) visit(child);
    states.set(node, "visited");
  };
  for (const node of selected.listChildren()) visit(node);
  return nodes;
}

interface PartCollection {
  readonly records: readonly GlbPartRecord[];
  readonly byMesh: ReadonlyMap<Mesh, readonly GlbPartRecord[]>;
}

function collectPartRecords(nodes: readonly Node[], diagnostics: GlbDiagnostics): PartCollection {
  const records: GlbPartRecord[] = [];
  const byMesh = new Map<Mesh, readonly GlbPartRecord[]>();
  const seenMeshes = new Set<Mesh>();
  for (const node of nodes) {
    const mesh = node.getMesh();
    if (mesh === null || seenMeshes.has(mesh)) continue;
    seenMeshes.add(mesh);
    const meshRecords = importMeshParts(mesh, records.length, diagnostics);
    records.push(...meshRecords);
    byMesh.set(mesh, meshRecords);
  }
  return { records, byMesh };
}

function nodeTransform(node: Node, diagnostics: GlbDiagnostics): Mat4 {
  const matrix = new Float32Array(node.getMatrix());
  if (matrix.some((value) => !Number.isFinite(value))) {
    diagnostics.fatal(
      "glb-invalid-transform",
      `Node ${nodeName(node, 0)} has a non-finite transform.`,
    );
  }
  return matrix;
}

function nodeName(node: Node, id: number): string {
  const name = node.getName().trim();
  return name.length === 0 ? `Node ${id}` : name;
}

function copyBytes(source: ArrayBuffer | Uint8Array): Uint8Array {
  return source instanceof Uint8Array ? new Uint8Array(source) : new Uint8Array(source.slice(0));
}

function validateContainer(bytes: Uint8Array, diagnostics: GlbDiagnostics): void {
  if (bytes.byteLength < HEADER_BYTES)
    diagnostics.fatal("glb-invalid-header", "GLB header is truncated.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== GLB_MAGIC)
    diagnostics.fatal("glb-invalid-header", "GLB magic is invalid.");
  if (view.getUint32(4, true) !== GLB_VERSION)
    diagnostics.fatal("glb-invalid-version", "Only GLB version 2 is supported.");
  if (view.getUint32(8, true) !== bytes.byteLength)
    diagnostics.fatal("glb-invalid-container", "GLB declared length does not match its bytes.");
}

function validateEmbeddedResources(jsonDocument: JSONDocument, diagnostics: GlbDiagnostics): void {
  for (const buffer of jsonDocument.json.buffers ?? []) {
    if (buffer.uri !== undefined)
      diagnostics.fatal("glb-invalid-container", "GLB must not reference external buffers.");
  }
  for (const image of jsonDocument.json.images ?? []) {
    if (image.uri !== undefined && !image.uri.startsWith("data:")) {
      diagnostics.fatal("glb-invalid-container", "GLB must not reference external images.");
    }
  }
}

function reportExtensions(jsonDocument: JSONDocument, diagnostics: GlbDiagnostics): void {
  for (const extension of jsonDocument.json.extensionsRequired ?? []) {
    if (extension === KHR_DRACO_MESH_COMPRESSION) continue;
    diagnostics.fatal(
      "glb-unsupported-required-extension",
      `Required GLB extension ${extension} is not supported.`,
    );
  }
  for (const extension of jsonDocument.json.extensionsUsed ?? []) {
    if (extension === KHR_DRACO_MESH_COMPRESSION) continue;
    diagnostics.warning(
      "glb-ignored-extension",
      `Ignored optional GLB extension ${extension}; only core display-scene data is imported.`,
      `extension:${extension}`,
    );
  }
}

function usesDracoCompression(jsonDocument: JSONDocument): boolean {
  return (jsonDocument.json.extensionsUsed ?? []).includes(KHR_DRACO_MESH_COMPRESSION);
}

function dracoDecoderOptions(): DracoDecoderOptions {
  if (dracoDecoderWasmUrl.startsWith("data:")) {
    return { wasmBinary: decodeDataUrl(dracoDecoderWasmUrl) };
  }
  return typeof window === "undefined" ? {} : { locateFile: () => dracoDecoderWasmUrl };
}

function decodeDataUrl(dataUrl: string): Uint8Array {
  const encoded = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const decoded = atob(encoded);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}
