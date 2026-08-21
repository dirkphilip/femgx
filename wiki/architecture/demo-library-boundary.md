# Demo / library boundary

The demo (`demo/`) is a thin consumer and test bench for the femgx public API
(the package facades under `src/entries/`). Reusable scene graphics, interaction rendering semantics, and
renderer synchronization live in `src/`; the demo owns application-specific
presentation and interaction policy only.

## Classification

**Library behavior (lives in `src/`):**

- Scene/assembly model, viewport-owned stable occurrence inspection, private
  packed scene state, and internal
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
- GPU picking (`ViewportInteraction.pick`) and pure interaction-target conversion.
- Opinionated SpaceClaim-style mouse/touch navigation
  (`installCameraControls`), camera math, asynchronous orbit-pivot handling,
  and the renderer-owned rotation-origin axis widget.
- The canonical `Viewport`: runtime compilation, camera fit/resize,
  standard controls, render invalidation, interaction/visibility GPU deltas,
  picking, scene replacement, device recovery, and teardown.

**Demo-only policy (stays in `demo/`):**

- DOM control wiring, the workbench controller, context menu, visibility
  panel, inspection text, deterministic model fixtures (`demo/fixtures/`),
  fixture/model selection, modifier-key target policy, and the demo-private
  two-pane viewport slots that share one authoritative `Scene` while owning
  independent presentation and interaction state (`demo/workbench/`). The
  two-pane mode must not become a public viewport manager, shared runtime, or
  renderer pool.
- Unsupported-state wording, diagnostics formatting, and the browser-test
  lifecycle seam (`demo/devtools/`).
- Performance telemetry and internal benchmark fixtures (`demo/benchmark/`).

## Svelte presentation boundary

The workbench presentation shell is the only Svelte-owned surface. Svelte
components may render immutable workbench snapshots and dispatch typed
demo-private commands, but they must not import `src/`, own model or viewport
state, schedule WebGPU frames, or recreate `Viewport` on
ordinary component updates. The plain TypeScript controller and session core
remain the lifecycle and state owners; Svelte is a replaceable presentation
layer.

### Workbench ownership and dependency direction

`presentation/snapshot.ts` owns the workbench-wide `WorkbenchPresentationPort`
and immutable snapshot stream.
Svelte receives its immutable snapshot stream and typed commands through that
port. The sole additional read is the bounded element-detail query, which keeps
a virtualized body list from copying an unbounded element-id array into every
snapshot. UI components must never import `controllers/` directly.

`controllers/` is the workbench composition owner: it wires model sessions,
viewport slots, interaction, presentation state, and the command-port adapter.
`start.ts` creates that owner; no other workbench implementation module may
depend on controllers. Conversely, implementation modules must not depend on
`ui/`. This makes the data and control direction visible without turning the
feature folders into a second framework.

The architecture lint checks those two boundaries, rejects runtime dependency
cycles under `demo/workbench/`, and applies the 400 effective-line ceiling to
Svelte components as well as TypeScript. It also bans new dynamic property
installation. `state/show-state.ts` retains one documented legacy adapter for
the pre-existing slot-map controller shape; it is an explicit ownership debt,
not a pattern for new work. A later state-ownership change should replace that
adapter with an explicit owner only when it can remove the surrounding wiring
rather than adding forwarding accessors.

The checks intentionally do not impose a function-count, command-count, or
generic abstraction-count limit. Clear responsibility, direct ownership, and
the smallest useful command groups remain review criteria. Type-only coupling
is also reviewed as an ownership signal, but the automated cycle check covers
runtime edges so it does not require a generic type barrel or churn existing
declaration-only relationships.

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

The demo passes presentation state to `Viewport`; it never calls renderer
upload or draw methods. The viewport derives interaction and visibility deltas,
owns the packed runtime, and resets its upload baseline after scene replacement
or recovery. This keeps the public host path and the demo test bench identical.

## Import enforcement

Ordinary demo code imports the explicit package facades under `src/entries/`,
which makes the workbench and retained product fixtures exercise the same
ownership boundaries as package consumers.
The repository lint gate checks this boundary so a new demo deep import cannot
quietly couple presentation code to implementation details. The three workbench
selection-summary call sites retain the narrowly scoped
`src/interaction/selection-queries` exception: those derived queries are
intentionally internal and absent from the public facades, but the workbench
needs them for selection feedback and snapshot counts.

Nine benchmark-only files plus the performance fixture are explicit exemptions
because they measure or inspect internal GPU/runtime representations rather than
model normal host usage:

- `demo/benchmark/interactive.ts`
- `demo/benchmark/measurement.ts`
- `demo/benchmark/workflows/selection.ts`
- `demo/benchmark/structured-fe.ts`
- `demo/benchmark/tet4-transfer.ts`
- `demo/benchmark/memory.ts`
- `demo/benchmark/model.ts`
- `demo/benchmark/transfer.ts`
- `demo/fixtures/performance-fixture.ts`

These exemptions are intentionally narrow. Packed runtime slots, renderer records,
capacities, and other benchmark internals remain non-public; ordinary demo code
must use the canonical `createViewport` workflow.

[architecture/packed-runtime|Packed scene runtime]: packed-runtime.md
[rendering/interactive-state|Interactive state]: ../rendering/interactive-state.md
[rendering/node-face-interaction|Node and face interaction]: ../rendering/node-face-interaction.md
[rendering/renderer-subrange-updates|Renderer subrange updates]: ../rendering/renderer-subrange-updates.md
