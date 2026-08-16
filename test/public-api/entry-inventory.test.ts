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
      "GeometryValidationError",
      "WebGpuUnsupportedError",
      "bodyOverride",
      "boxSelectionFrustum",
      "clearSelection",
      "createFemViewport",
      "createInteractionState",
      "createPart",
      "createResultField",
      "createScalarColorMap",
      "createScene",
      "deformGeometry",
      "deformPositions",
      "emphasizedBodyRefs",
      "emphasizedElementBlockRefs",
      "finiteRange",
      "hoveredTarget",
      "identity",
      "installBoxSelection",
      "interactionTargetFromHit",
      "isBodyEmphasized",
      "isBodyVisible",
      "isElementBlockEmphasized",
      "isElementBlockVisible",
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
      "setElementBlockHighlighted",
      "setElementBlockOverride",
      "setElementBlockSelected",
      "setElementBlockVisible",
      "setElementVisible",
      "setInstanceOverride",
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
      "ElementModelEditError",
      "ElementModelValidationError",
      "FaceSelectionError",
      "HEX20_SHAPE",
      "HEX8_SHAPE",
      "LINE3_SHAPE",
      "LINE_SHAPE",
      "POINT_SHAPE",
      "PYRAMID5_SHAPE",
      "QUAD8_SHAPE",
      "QUAD_SHAPE",
      "SurfacePartError",
      "TET10_SHAPE",
      "TET4_SHAPE",
      "TRI6_SHAPE",
      "TRIANGLE_SHAPE",
      "WEDGE6_SHAPE",
      "boundaryFaceRefs",
      "classifyFaces",
      "createElement",
      "createElementModel",
      "edgesOf",
      "editElementModel",
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
      "VtkWriteError",
      "createElementModelFromFemModel",
      "createModelBuilder",
      "createResultFieldFromModelResult",
      "parseVtk",
      "validateModel",
      "writeVtk",
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
    expect(root.createFemViewport).toBeTypeOf("function");
    expect(model.createElementModel).toBeTypeOf("function");
    expect(io.parseVtk).toBeTypeOf("function");
    expect(glb.importGlb).toBeTypeOf("function");
    expect(camera.createCamera).toBeTypeOf("function");
    expect(runtime.createSceneRuntime).toBeTypeOf("function");
    expect(platform.requestWebGpuDevice).toBeTypeOf("function");
  });
});
