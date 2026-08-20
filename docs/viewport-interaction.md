# Viewport lifecycle and interaction

{@link root.createViewport createViewport} is the supported rendering
lifecycle. It requests a real WebGPU device, owns the compiled runtime and GPU
resources, and exposes stable capability facades for view, interaction,
visibility, results, and presentation.

## Public symbols

| Symbol                                                                                                              | Role                                   |
| ------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| {@link root.createViewport createViewport} / {@link root.Viewport Viewport}                                         | WebGPU lifecycle and capability facade |
| {@link root.SceneUpdate SceneUpdate}                                                                                | Transaction-local structural editor    |
| {@link root.PickHit PickHit}                                                                                        | Physical GPU pick result               |
| {@link interaction.interactionTargetFromHit interactionTargetFromHit}                                               | Host-facing identity mapping           |
| {@link interaction.setTargetSelected setTargetSelected} / {@link interaction.setTargetsSelected setTargetsSelected} | Immutable selection transitions        |
| {@link interaction.installViewportInteraction installViewportInteraction}                                           | Disposable default pointer/box policy  |
| {@link interaction.boxSelectionFrustum boxSelectionFrustum}                                                         | Host-side through-query frustum        |

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
host target with {@link interaction.interactionTargetFromHit interactionTargetFromHit},
then publish an immutable state transition:

```ts
const hit = await viewport.interaction.pick(clientX, clientY);
const target = hit === undefined ? undefined : interactionTargetFromHit(hit, "element");

if (target !== undefined) {
  viewport.interaction.set(setTargetSelected(viewport.interaction.state, target, true));
}
```

For a visible-region query, {@link root.ViewportInteraction.pickRegion pickRegion}
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

For Core-now through-selection, use {@link interaction.boxSelectionFrustum boxSelectionFrustum}
with the host's authoritative placed FE geometry. It ignores raster occlusion
but respects explicit visibility, section planes, deformation, and occurrence
transforms. Tessellation diagonals are never authored edge identities.

## Visibility and structural changes

Part/assembly-wide convenience visibility and occurrence-specific visibility
are separate viewport-local policies:

```ts
viewport.visibility.setPartVisible(partId, false);
viewport.visibility.setPartOccurrenceVisible(partOccurrenceId, true);
viewport.visibility.setPartOccurrences(partOccurrenceIds, false);
viewport.visibility.setAssemblyVisible(assemblyId, false);
viewport.visibility.setAssemblyOccurrenceVisible(assemblyOccurrenceId, true);
```

Definition and occurrence causes remain independent, so showing one layer does
not clear a hide in another. The bulk occurrence setter validates the complete
iterable before one atomic renderer synchronization. Unknown identities are
rejected at the active scene/runtime boundary before a renderer mutation. For a
structural change, edit definitions and their
explicitly identified authoring placements in one synchronous transaction:

```ts
const outcome = viewport.updateScene((update) => {
  update.addPart(newPart);
  update.addPlacement(rootAssemblyId, {
    kind: "part",
    placementId: "new-part",
    partId: newPart.id,
    transform: identityMatrix(),
  });
});
if (outcome.results === "cleared") {
  console.warn(outcome.reason);
}
const currentOccurrences = viewport.occurrences;
```

`addPlacement`, `replacePlacement`, and `removePlacement` edit authored records
inside reusable assembly definitions. Occurrence ids instead address individual
expanded runtime instances for visibility, interaction, results, and queries.

The editor uses copy-on-write registries and publishes one immutable scene and
private packed revision only after complete validation. A thrown, nested, async, or
semantic no-op callback publishes nothing. Definition removal rejects live
references unless explicit cascade removal is requested. `updateScene`
preserves compatible camera, interaction, visibility, and authored-result state;
it clears only state that cannot address the new scene. Use `replaceScene` when
the change is an intentional unrelated-model reset.

## Related pages

- [Scenes and finite-element models](scene-and-model.md)
- [Results and import](results-and-import.md)
- [Runtime, camera, and WebGPU](runtime-and-platform.md)
