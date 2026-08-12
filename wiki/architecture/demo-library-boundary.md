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
  (`updateInstances`, `updateElements`, `updateVisibility`) plus the viewport's
  pure interaction-diff helper `changedInstanceSlots`
  ([[rendering/renderer-subrange-updates|Renderer subrange updates]]).
- GPU picking (`FemViewport.pick`) and pure interaction-target conversion.
- Opinionated SpaceClaim-style mouse/touch navigation
  (`installCameraControls`), camera math, asynchronous orbit-pivot handling,
  and the renderer-owned rotation-origin axis widget.
- The canonical `FemViewport`: runtime compilation, camera fit/resize,
  standard controls, render invalidation, interaction/visibility GPU deltas,
  picking, scene replacement, device recovery, and teardown.

**Demo-only policy (stays in `demo/`):**

- DOM control wiring, the workbench controller, context menu, visibility
  panel, inspection text, deterministic model fixtures (`demo/fixture/`),
  fixture/model selection, and modifier-key target policy (`demo/workbench/`).
- Unsupported-state wording, diagnostics formatting, and the browser-test
  lifecycle seam (`demo/devtools/`).
- Performance telemetry and internal benchmark fixtures (`demo/benchmark/`).

## Emphasis rendering

Node/face emphasis is represented and rendered entirely through library APIs,
never by deriving `elementOverrides`. The public `InteractionState` is opaque;
target queries and `setTarget*` operations cover selection, highlighting, and
the single hovered target, while explicit element overrides remain separate.
The WebGPU renderer maps those refs to emphasis records directly
([[rendering/node-face-interaction|Node and face interaction]]).

This removes the former demo-side `emphasis.ts` fold (node/face emphasis →
per-element overrides); emphasis appears through the renderer's node/face
emphasis records, the intended thin-consumer behavior that avoids duplicating
the WebGPU emphasis semantics.

## Viewport synchronization

The demo passes presentation state to `FemViewport`; it never calls renderer
upload or draw methods. The viewport derives interaction and visibility deltas,
owns the packed runtime, and resets its upload baseline after scene replacement
or recovery. This keeps the public host path and the demo test bench identical.

## Import enforcement

Ordinary demo code and retained product fixtures import library capabilities only
from `src/index.ts`. The repository lint gate checks this boundary so a new demo
deep import cannot quietly couple presentation code to implementation details.

Two benchmark-only files plus the performance fixture are explicit exemptions because they measure or inspect
internal GPU/runtime representations rather than model normal host usage:

- `demo/benchmark/runner.ts`
- `demo/benchmark/model.ts`
- `demo/fixture/performance-fixture.ts`

These exemptions are intentionally narrow. Packed runtime slots, renderer records,
capacities, and other benchmark internals remain non-public; ordinary demo code
must use the canonical `createFemViewport` workflow.

[architecture/packed-runtime|Packed scene runtime]: packed-runtime.md
[rendering/interactive-state|Interactive state]: ../rendering/interactive-state.md
[rendering/node-face-interaction|Node and face interaction]: ../rendering/node-face-interaction.md
[rendering/renderer-subrange-updates|Renderer subrange updates]: ../rendering/renderer-subrange-updates.md
