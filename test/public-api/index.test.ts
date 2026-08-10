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
  });
});
