# Selection and view context menu

The demo workbench keeps selection policy in `demo/workbench/selection.ts` and
applies it after asynchronous GPU picks in `WorkbenchInteraction`.

- A plain primary click replaces the current selection with the picked node,
  face, element, instance, or part. Re-clicking the same target deselects it,
  preserving the established toggle behavior.
- Control/Meta-click toggles the exact picked target, which provides additive
  selection and removal from a multi-selection. Shift still promotes a node or
  face to its element; Alt still promotes to the instance.
- A primary click in empty scene space clears selection. Pointer movement past
  the orbit threshold is treated as a gesture, so ending an orbit or pan does
  not clear selection.
- Right-clicking empty scene space opens a view menu with fit, clear selection,
  show-all, and reset-view actions. Right-clicking a picked target keeps the
  target-specific menu. The menu clamps to the viewport and closes after an
  action, Escape, or an outside click.

Visibility changes continue through `FemViewport` and the packed runtime. The
view-level show-all action restores authored assembly, part, and instance
visibility without changing the current selection or display mode.

Related: [[rendering/interactive-state|Interactive state]],
[[rendering/element-interaction|Element interaction]].

[rendering/element-interaction|Element interaction]: element-interaction.md
[rendering/interactive-state|Interactive state]: interactive-state.md
