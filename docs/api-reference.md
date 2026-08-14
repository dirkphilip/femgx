# femgx API reference

This is the generated reference for the experimental femgx 0.x API. The public
API may change without compatibility guarantees.

## Start here

The supported workflow is to define reusable geometry, place it in an
assembly, register the assembly in a scene, and hand that scene to one
viewport:

```ts
import { createFemViewport, createPart, createScene, identity } from "femgx";

const part = createPart(1, {
  positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
  indices: new Uint32Array([0, 1, 2]),
  primitive: "triangles",
});

const scene = createScene()
  .addPart(part)
  .addAssembly({
    id: 1,
    name: "model",
    placements: [{ kind: "part", partId: 1, transform: identity() }],
  })
  .withRoot(1)
  .build();

const viewport = await createFemViewport({ canvas, scene });
```

Start with {@link createPart}, {@link createScene}, and {@link createFemViewport}.
The generated
navigation groups the complete root API by supported workflow:

- Scene and geometry
- Elements and model editing
- Viewport lifecycle
- Interaction and picking
- Results
- Import and export
- Camera and math
- Advanced runtime and WebGPU platform

The full searchable index remains available in the generated navigation. The
advanced category documents stable supporting utilities and platform-facing
contracts; it is not a second renderer lifecycle.

Use the `Demo` link in the documentation header to return to the live demo.
