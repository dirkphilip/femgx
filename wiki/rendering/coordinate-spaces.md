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
textures use render-pixel dimensions.

Related: [[rendering/camera-presentation|Camera presentation]],
[[rendering/fe-inspection-workbench|FE inspection workbench]].

[rendering/camera-presentation|Camera presentation]: camera-presentation.md
[rendering/fe-inspection-workbench|FE inspection workbench]: fe-inspection-workbench.md
