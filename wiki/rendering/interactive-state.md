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

- Store stable logical targets in immutable interaction state and project them
  privately to affected part-occurrence and primitive slots. Assembly targets
  must not become public arrays of descendant part or element targets.
- The renderer should patch only affected instance attributes per frame, or
  adjust instance counts — never rebuild geometry or instance lists (see
  [[rendering/renderer-subrange-updates|Renderer subrange updates]]).
- Body selection, highlight, hover, and explicit style overrides use the same
  immutable interaction state pattern, keyed by `(partOccurrenceId, bodyId)`.
- The required `InteractionTarget` vocabulary covers assembly definition,
  assembly occurrence, part definition, part occurrence, body, element, face,
  node, and authored-edge targets. Assembly definitions affect all their
  occurrences; assembly occurrences affect one exact subtree. Hidden
  descendants remain hidden.
- `setTargetSelected`, `setTargetHighlighted`, and `setTargetHovered` must accept the
  same target vocabulary and dispatch without a mutable manager. Bulk selection
  and highlighting group duplicate targets and clone each touched immutable
  collection at most once.
- Shared target and renderer machinery does not merge interaction states.
  Hover and persistent highlight use the highlighted theme; selection uses the
  selected theme at every scope. In particular, selecting a part or part
  occurrence is genuine selection and must never insert that target into
  highlight state or use a highlight-like appearance.
- One selected assembly or part remains one logical selected target. Explicit
  element selection remains occurrence-scoped element identity; hosts use its
  packed bulk representation only when an element-only action genuinely needs
  all descendant elements.
- `clearSelection` clears every selection collection while preserving hover,
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
  `interactionTargetFromHit` to a
  [[architecture/architecture-overview|InteractionTarget]] at assembly,
  assembly-occurrence, part, part-occurrence, body, element, face, node, or edge
  granularity. A higher assembly ancestor is chosen explicitly from the path;
  the default hierarchy promotion is the direct owner.
- Every `PickHit` must carry a root-to-direct-owner assembly path. Each entry has
  both the reusable assembly id and exact assembly-occurrence id. The CPU
  resolves this ancestry from the authoritative runtime after reading the
  existing pick ids; it adds no GPU attachment, pass, buffer, or readback byte.

## Precedence

`resolveInstanceStyle` resolves base material and authored result color, applies
the highlighted theme for persistent highlight/hover, applies the selected
theme, then applies explicit part and part-occurrence overrides. Selection is
intentionally stronger than hover/highlight for properties it specifies, while
non-conflicting highlighted feedback remains visible. A selected theme color
overrides result color; a selected theme without color may retain it. The rule
is identical for assembly, part, occurrence, body, and subentity selection and
for dense, sparse, and instance renderer paths. The resulting complete style
can be copied directly into GPU state without material cloning.

For body-aware styles, part-occurrence state is resolved first, followed by body
highlight, body hover, body selection, and the explicit body override. Element,
face, and node state remains more specific than its owning body. Hidden body
records are applied before emphasis so every primitive belonging to that body is
excluded from the render and pick passes.

## Batching

`Viewport.batch(operation)` is a synchronous transaction boundary for related
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
  stores face/owner/neighbor records together with topology condition ranges in
  the existing pick-data buffer, so the renderer stays within the portable
  WebGPU vertex-stage storage-buffer limit; authored node sprites use the same
  packed layout for body-aware visibility and emphasis.

[architecture/architecture-overview|InteractionTarget]: ../architecture/architecture-overview.md
[rendering/node-face-interaction|Node and face interaction]: node-face-interaction.md
[rendering/renderer-subrange-updates|Renderer subrange updates]: renderer-subrange-updates.md
