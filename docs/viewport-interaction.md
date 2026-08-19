# Viewport lifecycle and interaction

[`createViewport`](https://github.com/dirkphilip/femgx/blob/main/src/viewport/viewport.ts#L92) is the supported rendering
lifecycle. It requests a real WebGPU device, owns the compiled runtime and GPU
resources, and exposes stable capability facades for view, interaction,
visibility, results, and presentation.

## Public symbols

| Symbol                                                                                                                                                                                                      | Role                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| [`createViewport`](https://github.com/dirkphilip/femgx/blob/main/src/viewport/viewport.ts#L92) / [`Viewport`](https://github.com/dirkphilip/femgx/blob/main/src/viewport/viewport.ts#L35)                   | WebGPU lifecycle and capability facade |
| [`PickHit`](https://github.com/dirkphilip/femgx/blob/main/src/picking/types.ts#L115)                                                                                                                        | Physical GPU pick result               |
| [`interactionTargetFromHit`](https://github.com/dirkphilip/femgx/blob/main/src/interaction/targets.ts#L33)                                                                                                  | Host-facing identity mapping           |
| [`setTargetSelected`](https://github.com/dirkphilip/femgx/blob/main/src/interaction/targets.ts#L82) / [`setTargetsSelected`](https://github.com/dirkphilip/femgx/blob/main/src/interaction/targets.ts#L111) | Immutable selection transitions        |
| [`installViewportInteraction`](https://github.com/dirkphilip/femgx/blob/main/src/interaction/viewport-interaction.ts#L52)                                                                                   | Disposable default pointer/box policy  |
| [`boxSelectionFrustum`](https://github.com/dirkphilip/femgx/blob/main/src/interaction/box-frustum.ts#L46)                                                                                                   | Host-side through-query frustum        |

## Create, use, and destroy a viewport

```ts
const viewport = await createViewport({ canvas, scene });

viewport.view.fit();
viewport.resize();

// When the host removes the canvas:
viewport.destroy();
```

The host owns the canvas and any event listeners it installs. The viewport
facades remain valid across resize, rendering, recovery, and scene replacement,
but calls after `destroy()` fail consistently.

## Picking and selection

`viewport.interaction.pick` returns physical information. Convert it to a stable
host target with [`interactionTargetFromHit`](https://github.com/dirkphilip/femgx/blob/main/src/interaction/targets.ts#L33),
then publish an immutable state transition:

```ts
const hit = await viewport.interaction.pick(clientX, clientY);
const target = hit === undefined ? undefined : interactionTargetFromHit(hit, "element");

if (target !== undefined) {
  viewport.interaction.set(setTargetSelected(viewport.interaction.state, target, true));
}
```

For a visible-region query, [`pickRegion`](https://github.com/dirkphilip/femgx/blob/main/src/viewport/viewport.ts#L92)
returns nearest-visible raster targets without mutating selection. Apply them in
one transition:

```ts
const targets = await viewport.interaction.pickRegion(
  { left: 20, top: 20, right: 320, bottom: 240 },
  "element",
);
viewport.interaction.set(setTargetsSelected(viewport.interaction.state, targets, true));
```

The default policy is opt-in and disposable:

```ts
import { installViewportInteraction } from "femgx/interaction";

const disposeInteraction = installViewportInteraction({
  viewport,
  canvas,
  granularity: () => "element",
});

disposeInteraction();
viewport.destroy();
```

For Core-now through-selection, use [`boxSelectionFrustum`](https://github.com/dirkphilip/femgx/blob/main/src/interaction/box-frustum.ts#L46)
with the host's authoritative placed FE geometry. It ignores raster occlusion
but respects explicit visibility, section planes, deformation, and occurrence
transforms. Tessellation diagonals are never authored edge identities.

## Visibility and structural changes

Definition-wide visibility and occurrence-specific visibility are separate:

```ts
viewport.visibility.setPart(partId, false);
viewport.visibility.setPartOccurrence(partOccurrenceId, true);
viewport.visibility.setAssembly(assemblyId, false);
viewport.visibility.setAssemblyOccurrence(assemblyOccurrenceId, true);
```

Unknown identities are rejected at the active scene/runtime boundary before a
renderer mutation. For a structural change, build a new immutable scene and
call `reconcileScene`; reacquire `viewport.runtime` afterward:

```ts
const outcome = viewport.reconcileScene(nextScene);
if (outcome.results === "cleared") {
  console.warn(outcome.reason);
}
const currentRuntime = viewport.runtime;
```

Use `replaceScene` when the change is an intentional reset. Reconciliation
preserves compatible camera, interaction, visibility, and authored-result state;
it clears only state that cannot address the new scene.

## Related pages

- [Scenes and finite-element models](scene-and-model.md)
- [Results and import](results-and-import.md)
- [Runtime, camera, and WebGPU](runtime-and-platform.md)
