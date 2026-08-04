# Interactive state

Highlight, selection, hover, and visibility must stay cheap at scale. The rule:
drive interactive state with per-instance GPU attributes, never CPU-side
material clones.

## Visibility

- Parts and assemblies each carry hide/show state on the CPU scene model.
- Hiding an assembly hides everything beneath it (hierarchy inheritance).
- `flattenAssembly` culls hidden instances at the source, so hidden geometry is
  never drawn and never consumes instance slots.

## Highlight / selection / hover

- Represent as per-instance overrides (e.g. emissive/color) patched into the
  instance GPU buffer.
- The renderer should patch only affected instance attributes per frame, or
  adjust instance counts — never rebuild geometry or instance lists (see
  [[renderer-subrange-updates|Renderer subrange updates]]).

## Picking

- GPU-based: render instance indices into a pick buffer and read back a single
  value on pointer events.
- CPU side resolves that id via `resolvePick(instances, pickId)` and maps it to a
  [[architecture-overview|PickTarget]] (part or instance).

## Precedence

`resolveInstanceStyle` applies base style, highlight, hover, selection, explicit
part override, then explicit instance override. More specific state wins, while
selection intentionally remains stronger than hover. The resulting complete style
can be copied directly into a GPU instance attribute without material cloning.
