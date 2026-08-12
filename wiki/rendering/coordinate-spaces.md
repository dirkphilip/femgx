# Coordinate spaces

femgx uses one top-left-origin path from browser input to displayed geometry:

1. **Client coordinates** are browser `clientX`/`clientY` CSS pixels.
2. **Canvas CSS coordinates** subtract the canvas bounding rectangle origin.
3. **Render pixels** scale CSS coordinates by the canvas backing-store size and
   clamp to its integer extent. This is the authoritative GPU-pick pixel.
4. **NDC** maps x/y to `[-1, 1]`, flips the top-left y axis, and uses WebGPU
   depth `[0, 1]`.
5. **Displayed world coordinates** include the instance transform and active
   GPU deformation. Pick-point APIs return this space.
6. **Part-local coordinates** are obtained only when a caller explicitly
   applies the inverse instance transform; they are never reported as world
   positions.

`clientToCanvasCss` and `canvasCssToRenderPixel` own browser-to-GPU conversion.
`projectPoint` and `unprojectPoint` own world/NDC conversion for both camera
projection modes. Camera width and height are CSS viewport dimensions; renderer
textures use render-pixel dimensions. Empty-space navigation reuses the target's
projected depth with the requested CSS x/y, producing a point on the
view-aligned plane through `camera.target` without adding a ray or ground-plane
abstraction. Camera panning consumes those same CSS deltas: at the target plane,
one pixel maps to `2 * distance * tan(fovY / 2) / height` world units in
perspective mode and `orthoHeight / height` in orthographic mode. Backing-store
size and devicePixelRatio do not enter the gesture conversion.

Related: [[rendering/camera-presentation|Camera presentation]],
[[rendering/fe-inspection-workbench|FE inspection workbench]].

[rendering/camera-presentation|Camera presentation]: camera-presentation.md
[rendering/fe-inspection-workbench|FE inspection workbench]: fe-inspection-workbench.md
