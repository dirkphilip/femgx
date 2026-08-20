import { describe, expect, it } from "vitest";
import * as root from "../../src/entries/root";
import * as model from "../../src/entries/model";
import * as io from "../../src/entries/io";
import * as glb from "../../src/entries/io/glb";
import * as camera from "../../src/entries/camera";
import * as interaction from "../../src/entries/interaction";
import * as results from "../../src/entries/results";
import * as platform from "../../src/entries/platform";

const inventory = (module: object): string[] => Object.keys(module).sort();

describe("public package entries", () => {
  it("keeps an exact runtime export inventory per entry", () => {
    expect(inventory(root)).toEqual([
      "GeometryValidationError",
      "InteractionGranularity",
      "UnknownSceneIdentityError",
      "WebGpuUnsupportedError",
      "createPart",
      "createSceneBuilder",
      "createViewport",
      "identityMatrix",
      "multiplyMatrices",
      "queryWebGpuSupport",
      "rotationZMatrix",
      "scalingMatrix",
      "transformPoint",
      "translationMatrix",
      "webGpuUnsupportedMessage",
    ]);
    expect(inventory(interaction)).toEqual([
      "bodyOverride",
      "boxSelectionFrustum",
      "clearSelection",
      "createInteractionState",
      "emphasizedBodyRefs",
      "hoveredTarget",
      "installBoxSelection",
      "installViewportInteraction",
      "interactionTargetFromHit",
      "isBodyEmphasized",
      "isBodyVisible",
      "isElementVisible",
      "isHoveredTarget",
      "isTargetHighlighted",
      "isTargetSelected",
      "selectedTargets",
      "setBodyOverride",
      "setBodyVisible",
      "setElementVisible",
      "setElementsVisible",
      "setPartOccurrenceOverride",
      "setPartOccurrenceOverrides",
      "setPartOverride",
      "setPartOverrides",
      "setTargetHighlighted",
      "setTargetHovered",
      "setTargetSelected",
      "setTargetsHighlighted",
      "setTargetsSelected",
    ]);
    expect(inventory(results)).toEqual([
      "FIELD_COMPONENT_COUNT",
      "FRAME_COMPONENT_COUNT",
      "LOAD_COMPONENT_COUNT",
      "createElementFrameField",
      "createNodalDisplacementBuffer",
      "createNodalLoadField",
      "createResultField",
      "createScalarColorMap",
      "deformGeometry",
      "deformPositions",
      "finiteRange",
      "frameAt",
      "mapScalarToColor",
      "scalarAt",
      "scalarRange",
      "vectorAt",
    ]);
    expect(inventory(model)).toEqual([
      "ElementModelValidationError",
      "ElementShape",
      "ExplicitTopologyError",
      "FaceSelectionError",
      "boundaryFaceRefs",
      "classifyFaces",
      "createElement",
      "createElementModel",
      "createPartFromElementModel",
      "createPartFromExplicitTopology",
      "edgesOf",
      "faceRefsOf",
      "facesOf",
      "topologyFor",
      "uniqueEdges",
    ]);
    expect(inventory(io)).toEqual([
      "FEMGX_FORMAT_VERSION",
      "IoError",
      "createElementModelFromFemModel",
      "createFemModelBuilder",
      "createResultFieldFromModelResult",
      "validateFemModel",
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
    expect(inventory(platform)).toEqual([
      "WebGpuUnsupportedError",
      "queryWebGpuSupport",
      "requestWebGpuAdapter",
      "requestWebGpuDevice",
      "webGpuUnsupportedMessage",
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
    expect(io.createFemModelBuilder).toBeTypeOf("function");
    expect(io.validateFemModel).toBeTypeOf("function");
    expect(io.createElementModelFromFemModel).toBeTypeOf("function");
    expect(io.createResultFieldFromModelResult).toBeTypeOf("function");
    expect(glb.importGlb).toBeTypeOf("function");
    expect(camera.createCamera).toBeTypeOf("function");
    expect(interaction.createInteractionState).toBeTypeOf("function");
    expect(results.createResultField).toBeTypeOf("function");
    expect(platform.requestWebGpuDevice).toBeTypeOf("function");
  });
});
