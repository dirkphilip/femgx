import { describe, expect, it } from "vitest";
import * as root from "../../src/entries/root";
import * as model from "../../src/entries/model";
import * as io from "../../src/entries/io";
import * as glb from "../../src/entries/io/glb";
import * as camera from "../../src/entries/camera";
import * as runtime from "../../src/entries/runtime";
import * as platform from "../../src/entries/platform";

const inventory = (module: object): string[] => Object.keys(module).sort();

describe("public package entries", () => {
  it("keeps an exact runtime export inventory per entry", () => {
    expect(inventory(root)).toEqual([
      "FIELD_COMPONENT_COUNT",
      "FRAME_COMPONENT_COUNT",
      "GeometryValidationError",
      "LOAD_COMPONENT_COUNT",
      "UnknownSceneIdentityError",
      "WebGpuUnsupportedError",
      "bodyOverride",
      "boxSelectionFrustum",
      "clearSelection",
      "createElementFrameField",
      "createInteractionState",
      "createNodalLoadField",
      "createPart",
      "createResultField",
      "createScalarColorMap",
      "createScene",
      "createViewport",
      "deformGeometry",
      "deformPositions",
      "emphasizedBodyRefs",
      "finiteRange",
      "frameAt",
      "hoveredTarget",
      "identity",
      "installBoxSelection",
      "installViewportInteraction",
      "interactionTargetFromHit",
      "isBodyEmphasized",
      "isBodyVisible",
      "isElementVisible",
      "isHoveredTarget",
      "isTargetHighlighted",
      "isTargetSelected",
      "mapScalar",
      "multiply",
      "nodalDisplacements",
      "queryWebGpuSupport",
      "rotationZ",
      "scalarAt",
      "scalarRange",
      "scale",
      "selectedTargets",
      "setBodyOverride",
      "setBodyVisible",
      "setElementVisible",
      "setPartOccurrenceOverride",
      "setPartOverride",
      "setTargetHighlighted",
      "setTargetHovered",
      "setTargetSelected",
      "setTargetsHighlighted",
      "setTargetsSelected",
      "transformPoint",
      "translation",
      "unsupportedMessage",
      "vectorAt",
    ]);
    expect(inventory(model)).toEqual([
      "ElementModelValidationError",
      "ElementShape",
      "FaceSelectionError",
      "SurfacePartError",
      "boundaryFaceRefs",
      "classifyFaces",
      "createElement",
      "createElementModel",
      "edgesOf",
      "elementPart",
      "facesOf",
      "facesOfElement",
      "surfacePart",
      "topologyFor",
      "uniqueEdges",
    ]);
    expect(inventory(io)).toEqual([
      "FEMGX_FORMAT_VERSION",
      "IoError",
      "createElementModelFromFemModel",
      "createModelBuilder",
      "createResultFieldFromModelResult",
      "validateModel",
    ]);
    expect(inventory(glb)).toEqual(["importGlb"]);
    expect(inventory(camera)).toEqual([
      "canvasCssToRenderPixel",
      "clientToCanvasCss",
      "createCamera",
      "fitCamera",
      "installCameraControls",
      "orbitCamera",
      "panCamera",
      "projectPoint",
      "projectPolygon",
      "projectionMatrix",
      "resizeCamera",
      "setProjection",
      "unprojectPoint",
      "viewMatrix",
      "viewProjectionMatrix",
      "zoomCamera",
      "zoomCameraAtPoint",
    ]);
    expect(inventory(runtime)).toEqual(["createSceneRuntime"]);
    expect(inventory(platform)).toEqual([
      "WebGpuUnsupportedError",
      "queryWebGpuSupport",
      "requestWebGpuAdapter",
      "requestWebGpuDevice",
      "unsupportedMessage",
    ]);
  });

  it("keeps optional and advanced ownership out of the canonical root", () => {
    expect(root).not.toHaveProperty("importGlb");
    expect(root).not.toHaveProperty("createSceneRuntime");
    expect(root).not.toHaveProperty("createCamera");
    expect(root).not.toHaveProperty("requestWebGpuAdapter");
    expect(root).not.toHaveProperty("requestWebGpuDevice");
    expect(root).not.toHaveProperty("resolveElementStyle");
    expect(root).not.toHaveProperty("WebGpuPickReadbackError");
  });

  it("exposes one runtime and one type-level entry for each documented domain", () => {
    expect(root.createViewport).toBeTypeOf("function");
    expect(model.createElementModel).toBeTypeOf("function");
    expect(io.createModelBuilder).toBeTypeOf("function");
    expect(io.validateModel).toBeTypeOf("function");
    expect(io.createElementModelFromFemModel).toBeTypeOf("function");
    expect(io.createResultFieldFromModelResult).toBeTypeOf("function");
    expect(glb.importGlb).toBeTypeOf("function");
    expect(camera.createCamera).toBeTypeOf("function");
    expect(runtime.createSceneRuntime).toBeTypeOf("function");
    expect(platform.requestWebGpuDevice).toBeTypeOf("function");
  });
});
