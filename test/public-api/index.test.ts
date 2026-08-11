import { describe, expect, it } from "vitest";
import * as publicApi from "../../src/index";

describe("public root API", () => {
  it("does not expose renderer/runtime implementation helpers", () => {
    expect(publicApi).not.toHaveProperty("changedInstanceSlots");
    expect(publicApi).not.toHaveProperty("cullInstances");
    expect(publicApi).not.toHaveProperty("extractFrustum");
    expect(publicApi).not.toHaveProperty("faceTriangles");
  });

  it("exposes the canonical scene, viewport, and results entry points", () => {
    expect(publicApi.createScene).toBeTypeOf("function");
    expect(publicApi.createFemViewport).toBeTypeOf("function");
    expect(publicApi.createResultField).toBeTypeOf("function");
    expect(publicApi.polygonGeometry).toBeTypeOf("function");
    expect(publicApi.polygonPart).toBeTypeOf("function");
    expect(publicApi.PolygonGeometryError).toBeTypeOf("function");
    expect(publicApi.boundaryFaceRefs).toBeTypeOf("function");
    expect(publicApi.FaceSelectionError).toBeTypeOf("function");
    expect(publicApi.heterogeneousElementParts).toBeTypeOf("function");
    expect(publicApi.HeterogeneousElementError).toBeTypeOf("function");
    expect(publicApi.createElementModelFromFemModel).toBeTypeOf("function");
  });

  it("exposes validated part-body metadata helpers", () => {
    expect(publicApi.validateBodies).toBeTypeOf("function");
    expect(publicApi.bodyIdForElement).toBeTypeOf("function");
    expect(publicApi.GeometryValidationError).toBeTypeOf("function");
    expect(publicApi.validateFaceSubset).toBeTypeOf("function");
  });

  it("exposes body interaction helpers through the root API", () => {
    expect(publicApi.setBodyVisible).toBeTypeOf("function");
    expect(publicApi.setBodyOverride).toBeTypeOf("function");
    expect(publicApi.setBodyHighlighted).toBeTypeOf("function");
    expect(publicApi.setBodySelected).toBeTypeOf("function");
    expect(publicApi.setHoveredBody).toBeTypeOf("function");
  });
});
