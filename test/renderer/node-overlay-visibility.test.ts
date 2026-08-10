import { describe, expect, it } from "vitest";
import { createCamera, projectPoint, unprojectPoint } from "../../src/camera/camera";
import {
  eyeDepth,
  isNodeOverlayVisible,
  nodeOverlaySlack,
} from "../../src/renderer/node-overlay-visibility";

describe("nodeOverlaySlack", () => {
  it("scales with scene length and never drops below the floor", () => {
    expect(nodeOverlaySlack(10)).toBeCloseTo(0.02, 12);
    expect(nodeOverlaySlack(1)).toBeCloseTo(0.002, 12);
    expect(nodeOverlaySlack(0)).toBe(1e-5);
    expect(nodeOverlaySlack(-2)).toBe(1e-5);
  });
});

describe("eyeDepth", () => {
  it("matches unprojectPoint distance for perspective cameras", () => {
    const camera = createCamera({
      mode: "perspective",
      position: [0, 0, 5],
      target: [0, 0, 0],
      near: 0.1,
      far: 100,
      width: 200,
      height: 200,
    });
    for (const z of [0, 0.25, 0.5, 0.75, 0.999]) {
      const world = unprojectPoint(camera, [100, 100, z]);
      const distance = Math.hypot(
        world[0] - camera.position[0],
        world[1] - camera.position[1],
        world[2] - camera.position[2],
      );
      expect(eyeDepth(z, camera.near, camera.far, "perspective")).toBeCloseTo(distance, 5);
    }
  });

  it("matches unprojectPoint distance for orthographic cameras", () => {
    const camera = createCamera({
      mode: "orthographic",
      position: [0, 0, 5],
      target: [0, 0, 0],
      near: 0.1,
      far: 100,
      orthoHeight: 4,
      width: 200,
      height: 200,
    });
    for (const z of [0, 0.25, 0.5, 0.75, 1]) {
      const world = unprojectPoint(camera, [100, 100, z]);
      const distance = Math.hypot(
        world[0] - camera.position[0],
        world[1] - camera.position[1],
        world[2] - camera.position[2],
      );
      expect(eyeDepth(z, camera.near, camera.far, "orthographic")).toBeCloseTo(distance, 5);
    }
  });
});

describe("isNodeOverlayVisible", () => {
  const near = 0.1;
  const far = 1000;

  it("keeps coplanar and slightly-nearer scene samples visible", () => {
    const slack = nodeOverlaySlack(10);
    expect(
      isNodeOverlayVisible({
        nodeDepth: 0.4,
        sceneDepths: [0.4, 0.4, 0.4, 0.4],
        near,
        far,
        projection: "perspective",
        slack,
      }),
    ).toBe(true);
    const nodeEye = eyeDepth(0.4, near, far, "perspective");
    const closerEye = nodeEye - slack * 0.25;
    const sceneDepth = perspectiveDepthForEye(closerEye, near, far);
    expect(
      isNodeOverlayVisible({
        nodeDepth: 0.4,
        sceneDepths: [sceneDepth, sceneDepth, sceneDepth, sceneDepth],
        near,
        far,
        projection: "perspective",
        slack,
      }),
    ).toBe(true);
  });

  it("stays visible when only some MSAA samples are nearer (silhouette noise)", () => {
    const slack = nodeOverlaySlack(10);
    const nodeEye = eyeDepth(0.4, near, far, "perspective");
    const nearer = perspectiveDepthForEye(nodeEye - slack * 4, near, far);
    expect(
      isNodeOverlayVisible({
        nodeDepth: 0.4,
        sceneDepths: [nearer, nearer, 1, nearer],
        near,
        far,
        projection: "perspective",
        slack,
      }),
    ).toBe(true);
  });

  it("hides nodes only when every MSAA sample is a nearer occluder", () => {
    for (const distance of [3, 10, 40, 120]) {
      const slack = nodeOverlaySlack(distance);
      const front = projectDepthAt(distance - 0.5, near, far);
      const back = projectDepthAt(distance + 0.5, near, far);
      expect(
        isNodeOverlayVisible({
          nodeDepth: back,
          sceneDepths: [front, front, front, front],
          near,
          far,
          projection: "perspective",
          slack,
        }),
      ).toBe(false);
      expect(
        isNodeOverlayVisible({
          nodeDepth: front,
          sceneDepths: [front, front, front, front],
          near,
          far,
          projection: "perspective",
          slack,
        }),
      ).toBe(true);
    }
  });

  it("treats clear/far scene depth as visible", () => {
    const slack = nodeOverlaySlack(8);
    expect(
      isNodeOverlayVisible({
        nodeDepth: 0.35,
        sceneDepths: [1, 1, 1, 1],
        near,
        far,
        projection: "perspective",
        slack,
      }),
    ).toBe(true);
    expect(
      isNodeOverlayVisible({
        nodeDepth: 0.35,
        sceneDepths: [1],
        near,
        far,
        projection: "orthographic",
        slack,
      }),
    ).toBe(true);
  });

  it("matches projectPoint depths for world points along the view axis", () => {
    const camera = createCamera({
      mode: "perspective",
      position: [0, 0, 8],
      target: [0, 0, 0],
      near: 0.05,
      far: 500,
      width: 400,
      height: 400,
    });
    const slack = nodeOverlaySlack(8);
    const front = projectPoint(camera, [0, 0, 0.5]);
    const back = projectPoint(camera, [0, 0, -0.5]);
    expect(front).toBeDefined();
    expect(back).toBeDefined();
    if (front === undefined || back === undefined) return;
    expect(
      isNodeOverlayVisible({
        nodeDepth: back[2],
        sceneDepths: [front[2], front[2], front[2], front[2]],
        near: camera.near,
        far: camera.far,
        projection: "perspective",
        slack,
      }),
    ).toBe(false);
    expect(
      isNodeOverlayVisible({
        nodeDepth: front[2],
        sceneDepths: [front[2], front[2], front[2], front[2]],
        near: camera.near,
        far: camera.far,
        projection: "perspective",
        slack,
      }),
    ).toBe(true);
  });
});

/** Inverse of perspective eyeDepth for synthetic occluder construction. */
function perspectiveDepthForEye(eye: number, near: number, far: number): number {
  return (far - (near * far) / eye) / (far - near);
}

/** NDC depth of a point at positive eye distance along the view axis. */
function projectDepthAt(eye: number, near: number, far: number): number {
  return perspectiveDepthForEye(eye, near, far);
}
