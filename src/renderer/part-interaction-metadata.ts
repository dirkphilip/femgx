import type {
  ElementTessellation,
  FaceTessellation,
  GeometryBody,
  GeometryElementBlock,
} from "../geometry/types";
import type { BodyId, Part } from "../geometry/part";

type ElementId = ElementTessellation["id"];
type ElementBlockId = GeometryElementBlock["id"];

interface FaceMetadata {
  readonly face: FaceTessellation;
  readonly faceId: number;
}

/** Immutable lookup tables for semantic metadata used by renderer interaction. */
export interface PartInteractionMetadata {
  readonly elements: ReadonlyMap<ElementId, ElementTessellation>;
  readonly bodies: ReadonlyMap<BodyId, GeometryBody>;
  readonly blocks: ReadonlyMap<ElementBlockId, GeometryElementBlock>;
  readonly bodyByElement: ReadonlyMap<ElementId, BodyId>;
  readonly blockByElement: ReadonlyMap<ElementId, ElementBlockId>;
  readonly bodyByBlock: ReadonlyMap<ElementBlockId, BodyId>;
  readonly faces: ReadonlyMap<string, FaceMetadata>;
}

const metadataByPart = new WeakMap<Part, PartInteractionMetadata>();

/** Returns cached immutable interaction metadata for one part identity. */
export function getPartInteractionMetadata(part: Part): PartInteractionMetadata {
  const cached = metadataByPart.get(part);
  if (cached !== undefined) return cached;
  const metadata = buildPartInteractionMetadata(part);
  metadataByPart.set(part, metadata);
  return metadata;
}

function buildPartInteractionMetadata(part: Part): PartInteractionMetadata {
  const { geometry } = part;
  const elements = new Map((geometry.elements ?? []).map((element) => [element.id, element]));
  const bodies = new Map((geometry.bodies ?? []).map((body) => [body.id, body]));
  const blocks = new Map((geometry.blocks ?? []).map((block) => [block.id, block]));
  const bodyByElement = new Map<ElementId, BodyId>();
  const blockByElement = new Map<ElementId, ElementBlockId>();
  for (const element of geometry.elements ?? []) {
    if (element.bodyId !== undefined) bodyByElement.set(element.id, element.bodyId);
    if (element.blockId !== undefined) blockByElement.set(element.id, element.blockId);
  }
  for (const body of geometry.bodies ?? []) {
    for (const elementId of body.elementIds) {
      if (!bodyByElement.has(elementId)) bodyByElement.set(elementId, body.id);
    }
  }
  for (const block of geometry.blocks ?? []) {
    for (const elementId of block.elementIds) {
      if (!blockByElement.has(elementId)) blockByElement.set(elementId, block.id);
    }
  }
  const bodyByBlock = new Map<ElementBlockId, BodyId>();
  for (const element of geometry.elements ?? []) {
    const blockId = blockByElement.get(element.id);
    const bodyId = bodyByElement.get(element.id);
    if (blockId !== undefined && bodyId !== undefined && !bodyByBlock.has(blockId)) {
      bodyByBlock.set(blockId, bodyId);
    }
  }
  const faces = new Map<string, FaceMetadata>();
  if (geometry.primitive === "triangles") {
    for (const [faceId, face] of (geometry.faces ?? []).entries()) {
      faces.set(faceKey(face.elementId, face.faceIndex), { face, faceId });
    }
  }
  return { elements, bodies, blocks, bodyByElement, blockByElement, bodyByBlock, faces };
}

function faceKey(elementId: ElementId, faceIndex: number): string {
  return `${elementId}/${faceIndex}`;
}
