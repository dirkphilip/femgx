<script lang="ts">
  import {
    BASE_RESULT_VALUE,
    DEFORMATION_OFF_VALUE,
    VECTOR_OFF_VALUE,
    vectorGlyphLabel,
    vectorTransformLabel,
  } from "../results/result-controls";
  import type { WorkbenchController } from "../controllers/controller";
  import type { WorkbenchResultField, WorkbenchSnapshot } from "../results/snapshot";
  import type { WorkbenchResultPlaybackField } from "../results/result-playback";
  import type { SectionAxis } from "../section-controls";

  let {
    controller,
    snapshot,
  }: {
    controller: WorkbenchController | undefined;
    snapshot: WorkbenchSnapshot | undefined;
  } = $props();

  function selectValue(event: unknown): string | undefined {
    if (typeof event !== "object" || event === null || !("currentTarget" in event)) {
      return undefined;
    }
    const currentTarget = event.currentTarget;
    if (
      typeof currentTarget !== "object" ||
      currentTarget === null ||
      !("value" in currentTarget)
    ) {
      return undefined;
    }
    const value = currentTarget.value;
    return typeof value === "string" ? value : undefined;
  }

  function setResultField(event: unknown): void {
    const value = selectValue(event);
    if (value !== undefined) controller?.commands.setResultField(value);
  }

  function setDeformationField(event: unknown): void {
    const value = selectValue(event);
    if (value !== undefined) controller?.commands.setDeformationField(value);
  }

  function setDeformationScale(event: unknown): void {
    const value = selectValue(event);
    if (value !== undefined) controller?.commands.setDeformationScale(value);
  }

  function setVectorField(event: unknown): void {
    const value = selectValue(event);
    if (value !== undefined) controller?.commands.setVectorField(value);
  }

  function setVectorGlyph(event: unknown): void {
    const value = selectValue(event);
    if (value !== undefined) controller?.commands.setVectorGlyph(value);
  }

  function setVectorTransform(event: unknown): void {
    const value = selectValue(event);
    if (value !== undefined) controller?.commands.setVectorTransform(value);
  }

  function setVectorLengthScale(event: unknown): void {
    const value = selectValue(event);
    if (value !== undefined) controller?.commands.setVectorLengthScale(value);
  }

  function setVectorWidthPixels(event: unknown): void {
    const value = selectValue(event);
    if (value !== undefined) controller?.commands.setVectorWidthPixels(value);
  }

  function setSectionAxis(event: unknown): void {
    const value = selectValue(event);
    if (isSectionAxis(value)) controller?.commands.setSectionAxis(value);
  }

  function setSectionOffset(event: unknown): void {
    const value = selectValue(event);
    if (value !== undefined) controller?.commands.setSectionOffset(value);
  }

  function setPlaybackIndex(event: unknown): void {
    const value = selectValue(event);
    if (value !== undefined) controller?.commands.setResultPlaybackIndex(value);
  }

  function setPlaybackRate(event: unknown): void {
    const value = selectValue(event);
    if (value !== undefined) controller?.commands.setResultPlaybackRate(value);
  }

  function fieldLabel(field: WorkbenchResultField): string {
    return `${field.name} · ${field.location === "nodal" ? "Nodal" : "Elemental"}`;
  }

  function playbackFieldLabel(field: WorkbenchResultPlaybackField, stepLabel: string): string {
    return `${field.name} · ${field.location === "nodal" ? "Nodal" : "Elemental"} · Unit ${field.unit} · ${stepLabel}`;
  }

  function formatOffset(value: number): string {
    return String(Math.abs(value) < 1e-9 ? 0 : Number(value.toPrecision(5)));
  }

  function isSectionAxis(value: string | undefined): value is SectionAxis {
    return value === "off" || value === "x" || value === "y" || value === "z";
  }

  function hasScalarFields(): boolean {
    return (snapshot?.analysis.scalarFields.length ?? 0) > 0;
  }

  function hasActiveScalar(): boolean {
    return (
      hasScalarFields() &&
      snapshot?.analysis.scalarFieldId !== BASE_RESULT_VALUE &&
      snapshot?.analysis.resultMode !== "base"
    );
  }

  function hasDeformationFields(): boolean {
    return (snapshot?.analysis.deformationFields.length ?? 0) > 0;
  }

  function showDeformationSection(): boolean {
    return hasActiveScalar() && hasDeformationFields();
  }

  function hasActiveDeformation(): boolean {
    return (
      showDeformationSection() && snapshot?.analysis.deformationFieldId !== DEFORMATION_OFF_VALUE
    );
  }

  function hasVectorFields(): boolean {
    return (snapshot?.analysis.vectorFields.length ?? 0) > 0;
  }

  function hasActiveVector(): boolean {
    return hasVectorFields() && !(snapshot?.analysis.vectorControlsDisabled ?? true);
  }

  function hasActiveFrame(): boolean {
    const fieldId = snapshot?.analysis.vector.fieldId;
    return (
      snapshot?.analysis.vectorFields.some(
        (field) => field.id === fieldId && field.shape === "frame",
      ) ?? false
    );
  }

  function hasResultFields(): boolean {
    return hasScalarFields() || hasDeformationFields() || hasVectorFields();
  }

  function hasPlayback(): boolean {
    return snapshot?.analysis.playback !== undefined;
  }

  function activePlaybackSnapshot(): NonNullable<WorkbenchSnapshot["analysis"]["playback"]> {
    const playback = snapshot?.analysis.playback;
    if (playback === undefined) throw new Error("Result playback is not active");
    return playback;
  }
</script>

<div
  id="analysis-surface"
  data-testid="analysis-surface"
  class="analysis-inspector"
  role="group"
  aria-label="Analysis inspector"
>
  {#if hasPlayback()}
    <section
      id="result-playback-controls"
      data-testid="result-playback-controls"
      class="analysis-section result-playback-controls"
      role="group"
      aria-labelledby="result-playback-heading"
    >
      <h3 id="result-playback-heading">{activePlaybackSnapshot().label}</h3>
      <div class="result-playback-actions">
        <button
          type="button"
          data-testid="result-playback-previous"
          aria-label="Previous result snapshot"
          disabled={!activePlaybackSnapshot().hasPrevious}
          onclick={() => controller?.commands.previousResultPlayback()}>Previous</button
        >
        <button
          type="button"
          data-testid="result-playback-play"
          aria-label={activePlaybackSnapshot().playing
            ? "Pause result playback"
            : "Play result playback"}
          aria-pressed={activePlaybackSnapshot().playing}
          onclick={() => controller?.commands.toggleResultPlayback()}
          >{activePlaybackSnapshot().playing ? "Pause" : "Play"}</button
        >
        <button
          type="button"
          data-testid="result-playback-next"
          aria-label="Next result snapshot"
          disabled={!activePlaybackSnapshot().hasNext}
          onclick={() => controller?.commands.nextResultPlayback()}>Next</button
        >
      </div>
      <label for="result-playback-index">
        <span>Snapshot</span>
        <input
          id="result-playback-index"
          data-testid="result-playback-index"
          type="range"
          min="0"
          max={activePlaybackSnapshot().count - 1}
          step="1"
          value={activePlaybackSnapshot().index}
          oninput={setPlaybackIndex}
          aria-label="Result snapshot"
        />
      </label>
      <div
        class="result-playback-position"
        data-testid="result-playback-position"
        aria-live="polite"
      >
        {activePlaybackSnapshot().stepLabel} · t={formatOffset(activePlaybackSnapshot().time)} ·
        {activePlaybackSnapshot().index + 1}/{activePlaybackSnapshot().count}
      </div>
      <label for="result-playback-rate">
        <span>Rate</span>
        <select
          id="result-playback-rate"
          data-testid="result-playback-rate"
          aria-label="Result playback rate"
          value={String(activePlaybackSnapshot().rate)}
          onchange={setPlaybackRate}
        >
          <option value="0.5">0.5×</option>
          <option value="1">1×</option>
          <option value="2">2×</option>
        </select>
      </label>
    </section>
  {/if}
  <section
    id="result-controls"
    data-testid="result-controls"
    data-analysis-section="scalar"
    class="analysis-section result-controls"
    role="group"
    aria-labelledby="scalar-heading"
    hidden={!hasScalarFields()}
  >
    <h3 id="scalar-heading">Scalar</h3>
    {#if snapshot?.analysis.playback?.active}
      {@const playback = snapshot.analysis.playback}
      <span
        id="result-playback-owner"
        class="result-playback-position"
        data-testid="result-playback-owner"
        aria-live="polite"
        >Playback active · {playbackFieldLabel(playback.scalar, playback.stepLabel)}</span
      >
    {/if}
    <label for="result-field">
      <span>Field</span>
      <select
        id="result-field"
        data-testid="result-field"
        aria-label="Scalar field"
        value={snapshot?.analysis.scalarFieldId ?? BASE_RESULT_VALUE}
        onchange={setResultField}
      >
        {#if snapshot?.analysis.playback?.active}
          {@const playback = snapshot.analysis.playback}
          <option value={playback.scalar.id} disabled>
            {playbackFieldLabel(playback.scalar, playback.stepLabel)}
          </option>
        {/if}
        <option value={BASE_RESULT_VALUE}>Base</option>
        {#each snapshot?.analysis.scalarFields ?? [] as field (field.id)}
          <option value={field.id}>{fieldLabel(field)}</option>
        {/each}
      </select>
    </label>
  </section>

  <section
    id="deformation-controls"
    data-testid="deformation-section"
    class="analysis-section"
    role="group"
    aria-labelledby="deformation-heading"
    hidden={!showDeformationSection()}
  >
    <h3 id="deformation-heading">Deformation</h3>
    <label for="deformation-field">
      <span>Field</span>
      <select
        id="deformation-field"
        data-testid="deformation-field"
        aria-label="Deformation field"
        value={snapshot?.analysis.deformationFieldId ?? DEFORMATION_OFF_VALUE}
        onchange={setDeformationField}
      >
        {#if snapshot?.analysis.playback?.active}
          {@const playback = snapshot.analysis.playback}
          <option value={playback.deformation.id} disabled>
            {playbackFieldLabel(playback.deformation, playback.stepLabel)}
          </option>
        {/if}
        <option value={DEFORMATION_OFF_VALUE}>Off</option>
        {#each snapshot?.analysis.deformationFields ?? [] as field (field.id)}
          <option value={field.id}>{field.name}</option>
        {/each}
      </select>
    </label>
    <label for="deformation-scale" hidden={!hasActiveDeformation()}>
      <span>Scale</span>
      <input
        id="deformation-scale"
        data-testid="deformation-scale"
        type="number"
        min="0"
        step="any"
        inputmode="decimal"
        value={snapshot?.analysis.deformationScale ?? 1}
        onchange={setDeformationScale}
        aria-label="Deformation scale"
      />
    </label>
  </section>

  <section
    id="orientation-controls"
    data-testid="orientation-section"
    class="analysis-section"
    role="group"
    aria-labelledby="orientation-heading"
    hidden={!hasVectorFields()}
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

  <section
    id="section-controls"
    data-testid="section-section"
    class="analysis-section section-controls"
    role="group"
    aria-labelledby="section-heading"
  >
    <h3 id="section-heading">Section</h3>
    <label for="section-axis">
      <span>Keep side</span>
      <select
        id="section-axis"
        data-testid="section-axis"
        aria-label="Section axis"
        value={snapshot?.analysis.sectionAxis ?? "off"}
        onchange={setSectionAxis}
      >
        <option value="off">Off</option>
        <option value="x">Keep +X</option>
        <option value="y">Keep +Y</option>
        <option value="z">Keep +Z</option>
      </select>
    </label>
    <label for="section-offset" hidden={snapshot?.analysis.sectionAxis === "off"}>
      <span>Offset</span>
      <input
        id="section-offset"
        data-testid="section-offset"
        type="range"
        min={snapshot?.analysis.sectionRange?.min ?? 0}
        max={snapshot?.analysis.sectionRange?.max ?? 1}
        step={snapshot?.analysis.sectionRange?.step ?? 1}
        value={snapshot?.analysis.sectionOffset ?? 0}
        aria-label="Section offset"
        oninput={setSectionOffset}
      />
      <output id="section-offset-value" data-testid="section-offset-value">
        {formatOffset(snapshot?.analysis.sectionOffset ?? 0)}
      </output>
    </label>
  </section>

  <p class="analysis-empty" hidden={hasResultFields()}>
    This model has no authored result fields. Sectioning remains available.
  </p>
</div>
