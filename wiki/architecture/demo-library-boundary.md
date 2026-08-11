# Demo / library boundary

The demo (`demo/`) is a thin consumer and test bench for the femgx public API
(`src/index.ts`). Reusable scene graphics, interaction rendering semantics, and
renderer synchronization live in `src/`; the demo owns application-specific
presentation and interaction policy only.

## Classification

**Library behavior (lives in `src/`):**

- Scene/assembly model, stable-handle runtime (`createSceneRuntime`), private
  packed runtime, and internal
  flatten/cull helpers ([[architecture/packed-runtime|Packed scene runtime]]).
- Interaction state, style resolution, and emphasis refs
  (`resolveInstanceStyle`, `resolveElementStyle`, `resolveFaceStyle`,
  `resolveNodeStyle`, `emphasizedNodeRefs`, `emphasizedFaceRefs`,
  `emphasizedElementRefs`) — see
  [[rendering/interactive-state|Interactive state]] and
  [[rendering/node-face-interaction|Node and face interaction]].
- GPU renderer and its delta-oriented subrange sync
  (`updateInstances`, `updateElements`, `updateVisibility`) plus the
  interaction-diff helper `changedInstanceSlots`
  ([[rendering/renderer-subrange-updates|Renderer subrange updates]]).
- GPU picking (`WebGpuRenderer.pick`, `resolvePick` / `resolvePickTarget`) and
  exact visible-surface points (`WebGpuRenderer.pickPoint`).
- Opinionated SpaceClaim-style mouse/touch navigation
  (`installCameraControls`), camera math, asynchronous orbit-pivot handling,
  and the renderer-owned rotation-origin axis widget.
- The canonical `FemViewport`: runtime compilation, camera fit/resize,
  standard controls, render invalidation, interaction/visibility GPU deltas,
  picking, scene replacement, device recovery, and teardown.

**Demo-only policy (stays in `demo/`):**

- DOM control wiring, the workbench controller, context menu, visibility
  panel, inspection text, status formatting, deterministic model fixtures
  (`demo/fixture/`), fixture/model selection, and modifier-key target policy
  (`controller.ts`, `view.ts`, `inspect.ts`, `pick.ts`).
- Unsupported-state wording, performance telemetry, and the browser-test
  lifecycle seam (`webgpu-demo.ts`).

## Emphasis rendering

Node/face emphasis is represented and rendered entirely through library APIs,
never by deriving `elementOverrides`. `InteractionState.elementOverrides` holds
only explicit element overrides (set via `setElementOverride`); node/face
emphasis stays in `selectedNodeIds`/`highlightedNodeIds`/`hoveredNode` and the
face equivalents. The WebGPU renderer maps those refs to emphasis records
directly ([[rendering/node-face-interaction|Node and face interaction]]).

This removes the former demo-side `emphasis.ts` fold (node/face emphasis →
per-element overrides); emphasis appears through the renderer's node/face
emphasis records, the intended thin-consumer behavior that avoids duplicating
the WebGPU emphasis semantics.

## Viewport synchronization

The demo passes presentation state to `FemViewport`; it never calls renderer
upload or draw methods. The viewport derives interaction and visibility deltas,
owns the packed runtime, and resets its upload baseline after scene replacement
or recovery. This keeps the public host path and the demo test bench identical.

[architecture/packed-runtime|Packed scene runtime]: packed-runtime.md
[rendering/interactive-state|Interactive state]: ../rendering/interactive-state.md
[rendering/node-face-interaction|Node and face interaction]: ../rendering/node-face-interaction.md
[rendering/renderer-subrange-updates|Renderer subrange updates]: ../rendering/renderer-subrange-updates.md
