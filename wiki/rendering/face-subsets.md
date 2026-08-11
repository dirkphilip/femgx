# Face subsets

Solid and surface element parts can retain the complete tessellated geometry
while drawing only a validated set of element faces:

```ts
const exterior = boundaryFaceRefs(model.elements);
const part = elementPart(1, model, "hex", "solid", { faceSubset: exterior });
```

`faceSubset` uses stable `{ elementId, faceIndex }` identities. Unknown elements,
out-of-range face indices, and duplicate identities raise `FaceSelectionError`
before rendering. `boundaryFaceRefs` derives the exterior set from the existing
canonical face classification; an explicit selection may also include interior
faces. An empty selection is valid and draws no triangles.

The resulting `Geometry` keeps the full vertex/index and pick metadata so face,
element, node, deformation, and instancing behavior remain unchanged. The
renderer uploads the reusable vertex buffer once and creates only a compact
index order for the selected triangles (and its edge order when an edge overlay
is requested). Selected index values still point into the original triangle
vertices, so GPU pick ids resolve the original face and element identities.
There is no second vertex mesh and no alternate renderer path.

Face subsets apply only to solid/surface triangle modes. They do not add face
labels, overlays, boolean surface editing, or multi-hit picking.

The triangle output of [[rendering/heterogeneous-elements|heterogeneous element
parts]] uses the same validated subset contract; line and point variants have
no faces and therefore do not accept `faceSubset`.

Related: [[data/elements-topology|Element topology]],
[[rendering/element-rendering|Element rendering]], and
[[architecture/core-api|Core API review]].
