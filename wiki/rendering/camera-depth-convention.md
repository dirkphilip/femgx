# Camera depth convention

The camera projection maps depth to **`[0, 1]`** to match WebGPU's clip space:
a point at the near plane gets `clip.z = 0` and a point at the far plane gets
`clip.z = w`. This convention is the single source of truth for every consumer:

- `src/camera/camera.ts` `projectionMatrix` (perspective and orthographic).
- `src/runtime/culling.ts` `extractFrustum`, which must derive the near plane
  from **row 2 alone** (`clip.z >= 0`) and the far plane from `row 3 - row 2`
  (`clip.z <= clip.w`). Left/right/bottom/top stay `row 3 ± row 0/1`.
- `src/camera/project-polygon.ts` `projectPolygon`, which clips a world-space
  polygon against the six clip-space planes (near plane first, so no vertex
  with `w <= 0` survives into the later passes) and projects it to screen
  points. This keeps geometry-anchored screen projections valid when a polygon
  straddles the camera plane instead of dropping it whole.

## History (issue #73)

The projection matrix previously used the OpenGL `[-1, 1]` depth mapping while
WebGPU clips at `[0, 1]`. Consequences that are now fixed:

- WebGPU clipped every triangle closer than `2 * near` (the effective `clip.z = 0`
  point of a `[-1, 1]` matrix), making geometry pop in/out when orbiting close
  to the camera.
- `extractFrustum` took the near plane from `row 3 + row 2`, which is only
  correct for `[-1, 1]`; with a `[0, 1]` matrix it placed the CPU near plane at
  roughly `0.5 * near`, disagreeing with the GPU near clip and causing
  in-frustum instances to flicker for `cullInstances` consumers.
- Screen-space polygon projection previously dropped a whole polygon when any
  vertex had `clip.w <= 0`; it now clips the polygon against the camera plane.

The depth convention is exercised by regression tests in `test/camera/` and
`test/runtime/culling.test.ts`.
