# Demo / library boundary

The demo (`demo/`) is a thin consumer and test bench for the femgx public API
(`src/index.ts`). Reusable scene graphics, interaction rendering semantics, and
renderer synchronization live in `src/`; the demo owns application-specific
presentation and interaction policy only.

## Classification

**Library behavior (lives in `src/`):**

- Scene/assembly model, packed runtime (`createSceneRuntime`), and internal
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
  and the renderer-owned pivot marker.

**Demo-only policy (stays in `demo/`):**

- DOM control wiring, the workbench controller, context menu, visibility
  panel, inspection text, status formatting, fixture/model selection, and
  modifier-key target policy (`controller.ts`, `view.ts`, `inspect.ts`,
  `pick.ts`, `fit.ts`).
- WebGPU renderer startup and device-loss recovery wiring (`webgpu-demo.ts`).

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

## Instance synchronization

The demo feeds the renderer real deltas: interaction changes produce the
affected instance slots via `changedInstanceSlots(runtime, previous, next)`,
and visibility changes use the runtime's `VisibilityDelta.changedInstanceIds`
through `updateVisibility`. It never rewrites every instance on a frame (the
former `allSlots(runtime)` whole-runtime patch). After a renderer recovery or
re-creation the demo resets its applied-interaction baseline to an empty state,
because a fresh attachment re-uploads records from an empty interaction state.
