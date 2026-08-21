<script lang="ts">
  import {
    VECTOR_OFF_VALUE,
    vectorGlyphLabel,
    vectorTransformLabel,
  } from "../results/result-controls";
  import type { WorkbenchPresentationPort, WorkbenchSnapshot } from "../presentation/snapshot";
  import { controlValue } from "./control-value";

  let {
    workbench,
    snapshot,
  }: {
    workbench: WorkbenchPresentationPort | undefined;
    snapshot: WorkbenchSnapshot | undefined;
  } = $props();

  function setVectorField(event: unknown): void {
    const value = controlValue(event);
    if (value !== undefined) workbench?.commands.setVectorField(value);
  }

  function setVectorGlyph(event: unknown): void {
    const value = controlValue(event);
    if (value !== undefined) workbench?.commands.setVectorGlyph(value);
  }

  function setVectorTransform(event: unknown): void {
    const value = controlValue(event);
    if (value !== undefined) workbench?.commands.setVectorTransform(value);
  }

  function setVectorLengthScale(event: unknown): void {
    const value = controlValue(event);
    if (value !== undefined) workbench?.commands.setVectorLengthScale(value);
  }

  function setVectorWidthPixels(event: unknown): void {
    const value = controlValue(event);
    if (value !== undefined) workbench?.commands.setVectorWidthPixels(value);
  }

  function hasActiveVector(): boolean {
    return (
      (snapshot?.analysis.vectorFields.length ?? 0) > 0 &&
      !(snapshot?.analysis.vectorControlsDisabled ?? true)
    );
  }

  function hasActiveFrame(): boolean {
    const fieldId = snapshot?.analysis.vector.fieldId;
    return (
      snapshot?.analysis.vectorFields.some(
        (field) => field.id === fieldId && field.shape === "frame",
      ) ?? false
    );
  }
</script>

<section
  id="orientation-controls"
  data-testid="orientation-section"
  class="analysis-section"
  role="group"
  aria-labelledby="orientation-heading"
  hidden={(snapshot?.analysis.vectorFields.length ?? 0) === 0}
>
  <h3 id="orientation-heading">Orientation</h3>
  <label for="vector-field">
    <span>Field</span>
    <select
      id="vector-field"
      data-testid="vector-field"
      aria-label="Elemental vector field"
      value={snapshot?.analysis.vector.fieldId ?? VECTOR_OFF_VALUE}
      onchange={setVectorField}
    >
      <option value={VECTOR_OFF_VALUE}>Off</option>
      {#each snapshot?.analysis.vectorFields ?? [] as field (field.id)}
        <option value={field.id}>{field.name} · Elemental</option>
      {/each}
    </select>
  </label>
  <label for="vector-glyph" hidden={!hasActiveVector() || hasActiveFrame()}>
    <span>Glyph</span>
    <select
      id="vector-glyph"
      data-testid="vector-glyph"
      aria-label="Orientation glyph"
      aria-describedby="vector-glyph-help"
      value={snapshot?.analysis.vector.glyph ?? "arrow"}
      onchange={setVectorGlyph}
    >
      <option value="arrow">{vectorGlyphLabel("arrow")}</option>
      <option value="axis">{vectorGlyphLabel("axis")}</option>
    </select>
  </label>
  <label for="vector-transform" hidden={!hasActiveVector() || hasActiveFrame()}>
    <span>Transform as</span>
    <select
      id="vector-transform"
      data-testid="vector-transform"
      aria-label="Transform as"
      aria-describedby="vector-transform-help"
      value={snapshot?.analysis.vector.transform ?? "direction"}
      onchange={setVectorTransform}
    >
      <option value="direction">{vectorTransformLabel("direction")}</option>
      <option value="normal">{vectorTransformLabel("normal")}</option>
    </select>
  </label>
  <label for="vector-length-scale" hidden={!hasActiveVector()}>
    <span>Vector scale</span>
    <input
      id="vector-length-scale"
      data-testid="vector-length-scale"
      type="number"
      min="0.01"
      step="any"
      inputmode="decimal"
      value={snapshot?.analysis.vector.lengthScale ?? 1}
      onchange={setVectorLengthScale}
      aria-label="Vector length scale"
    />
  </label>
  <label for="vector-width-pixels" hidden={!hasActiveVector()}>
    <span>Width (CSS px)</span>
    <input
      id="vector-width-pixels"
      data-testid="vector-width-pixels"
      type="number"
      min="1"
      max="8"
      step="any"
      inputmode="decimal"
      value={snapshot?.analysis.vector.widthPixels ?? 2}
      onchange={setVectorWidthPixels}
      aria-label="Vector glyph width in CSS pixels"
    />
  </label>
  <span
    id="vector-glyph-help"
    data-testid="vector-glyph-help"
    class="result-orientation-help"
    hidden={!hasActiveVector()}
  >
    {hasActiveFrame()
      ? "RGB lines show the authored positive X, Y, and Z axes at each element anchor."
      : "Arrow preserves sign and starts at the element anchor; Axis is centered and treats opposite signs as the same orientation."}
  </span>
  <span
    id="vector-transform-help"
    data-testid="vector-transform-help"
    class="result-orientation-help"
    hidden={!hasActiveVector()}
  >
    {hasActiveFrame()
      ? "The complete part-local frame follows every occurrence of its reusable part."
      : "Spatial direction follows the occurrence's linear transform for fibers and tangents; Surface normal uses the inverse-transpose transform for shell normals, including non-uniform or mirrored transforms."}
  </span>
  <span
    id="vector-help"
    data-testid="vector-help"
    class="result-orientation-help"
    hidden={!hasActiveVector()}
  >
    {hasActiveFrame()
      ? "Frame axes are normalized for display and are not pick targets. Faded fragments are behind opaque model geometry."
      : "Authored vectors are normalized for display; magnitude is not displayed. Faded fragments are behind opaque model geometry."}
  </span>
</section>
