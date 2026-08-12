# Interactive state

Highlight, selection, hover, and visibility must stay cheap at scale. The rule:
drive interactive state with per-instance GPU attributes, never CPU-side
material clones.

## Visibility

- Parts and assemblies each carry hide/show state on the CPU scene model.
- Hiding an assembly hides everything beneath it (hierarchy inheritance).
- The scene runtime culls hidden instances at the source, so hidden geometry is
  never drawn and never consumes visible draw-list slots.
- Parts may also define stable body groups. Body visibility is interaction state
  scoped by instance and body id, so hiding one body does not alter reusable
  geometry or another placement of that part.

## Highlight / selection / hover

- Represent as per-instance overrides (e.g. emissive/color) patched into the
  instance GPU buffer.
- The renderer should patch only affected instance attributes per frame, or
  adjust instance counts — never rebuild geometry or instance lists (see
  [[rendering/renderer-subrange-updates|Renderer subrange updates]]).
- Body selection, highlight, hover, and explicit style overrides use the same
  immutable interaction state pattern, keyed by `(instanceId, bodyId)`.
- `InteractionTarget` is the identity-only union for part, instance, body,
  element, face, and node targets. `setTargetSelected` and
  `setTargetHighlighted` dispatch to the owning granular state without a
  mutable manager; `setTargetsHighlighted` is the deterministic bulk form.
- `clearSelection` clears all six selection collections while preserving hover,
  highlights, visibility, results overrides, and explicit styles.
- The private `interaction/mechanics.ts` module centralizes immutable nested
  collection updates, reference equality, deterministic ordering, deduplication,
  and style-layer merging; domain modules retain explicit body/element/face/node
  vocabulary.
- Body emphasis is recorded in the element-highlight table and resolved on the
  GPU before element, face, or node emphasis. Body visibility is a GPU hidden
  bit, not a CPU material clone or geometry rewrite. Cached pick snapshots track
  the applied hidden-body collection, so hiding or showing a body invalidates
  the snapshot while selection and highlight changes reuse it.

## Picking

- GPU-based: render instance indices into a pick buffer and read back a single
  value on pointer events.
- CPU side receives a complete `PickHit` and maps it with
  `interactionTargetFromHit` to a [[architecture/architecture-overview|InteractionTarget]] (part, instance,
  element, face, or node).

## Precedence

`resolveInstanceStyle` applies base style, highlight, hover, selection, explicit
part override, then explicit instance override. More specific state wins, while
selection intentionally remains stronger than hover. The resulting complete style
can be copied directly into a GPU instance attribute without material cloning.

For body-aware styles, instance state is resolved first, followed by body
highlight, body hover, body selection, and the explicit body override. Element,
face, and node state remains more specific than its owning body. Hidden body
records are applied before emphasis so every primitive belonging to that body is
excluded from the render and pick passes.

## Batching

`FemViewport.batch(operation)` is a synchronous transaction boundary for related
mutations. Nested batches share the outer boundary; the final interaction state
and visibility state preserve operation order, while visibility slots are sent to
the renderer once as a sorted union and one invalidation schedules the frame.
Body emphasis still uses immutable state and the existing diffed
`updateElements` path. Batches do not cross frames or await asynchronous work.

## Emphasis representation

- `InteractionState.highlightedElementIds` holds semantic element highlights;
  `InteractionState.elementOverrides` holds **explicit** element overrides only
  (`setElementOverride`); node/face emphasis is never folded into it. Node and
  face emphasis live in their own per-instance sets/maps and render through
  `emphasizedNodeRefs`/`emphasizedFaceRefs` and `resolveNodeStyle`/
  `resolveFaceStyle`
  ([[rendering/node-face-interaction|Node and face interaction]]).
- Interaction changes patch only affected instance slots via the viewport's
  `changedInstanceSlots` feeding `updateInstances`; element/node/face emphasis
  flows through `updateElements`, with semantic element highlights also marking
  their owning slot in the interaction diff
  ([[rendering/renderer-subrange-updates|Renderer subrange updates]]).
- Body records are included in the same `updateElements` path. Surface geometry
  stores face/body pairs together with topology ownership ranges in the existing
  pick-data buffer, so the renderer stays within the portable WebGPU
  vertex-stage storage-buffer limit; authored node sprites use the same packed
  layout for body-aware visibility and emphasis.

[architecture/architecture-overview|InteractionTarget]: ../architecture/architecture-overview.md
[rendering/node-face-interaction|Node and face interaction]: node-face-interaction.md
[rendering/renderer-subrange-updates|Renderer subrange updates]: renderer-subrange-updates.md
