<script lang="ts">
  import { BASE_RESULT_VALUE, DEFORMATION_OFF_VALUE, VECTOR_OFF_VALUE } from "../result-controls";
  import type { WorkbenchController } from "../controller";
  import type { WorkbenchResultField, WorkbenchSnapshot } from "../snapshot";
  import type { SectionAxis } from "../section-controls";

  let {
    controller,
    snapshot,
  }: {
    controller: WorkbenchController | undefined;
    snapshot: WorkbenchSnapshot | undefined;
  } = $props();

  function selectValue(event: unknown): string | undefined {
    if (typeof event !== "object" || event === null) return undefined;
    const currentTarget = Reflect.get(event, "currentTarget");
    if (typeof currentTarget !== "object" || currentTarget === null) return undefined;
    const value = Reflect.get(currentTarget, "value");
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

  function fieldLabel(field: WorkbenchResultField): string {
    return `${field.name} · ${field.location === "nodal" ? "Nodal" : "Elemental"}`;
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

  function hasResultFields(): boolean {
    return hasScalarFields() || hasDeformationFields() || hasVectorFields();
  }
</script>

<div
  id="analysis-surface"
  data-testid="analysis-surface"
  class="analysis-inspector"
  role="group"
  aria-label="Analysis inspector"
>
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
    <label for="result-field">
      <span>Field</span>
      <select
        id="result-field"
        data-testid="result-field"
        aria-label="Scalar field"
        value={snapshot?.analysis.scalarFieldId ?? BASE_RESULT_VALUE}
        onchange={setResultField}
      >
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
    <label for="vector-glyph" hidden={!hasActiveVector()}>
      <span>Glyph</span>
      <select
        id="vector-glyph"
        data-testid="vector-glyph"
        aria-label="Vector glyph"
        value={snapshot?.analysis.vector.glyph ?? "arrow"}
        onchange={setVectorGlyph}
      >
        <option value="arrow">Arrow</option>
        <option value="axis">Axis</option>
      </select>
    </label>
    <label for="vector-transform" hidden={!hasActiveVector()}>
      <span>Transform</span>
      <select
        id="vector-transform"
        data-testid="vector-transform"
        aria-label="Vector transform"
        value={snapshot?.analysis.vector.transform ?? "direction"}
        onchange={setVectorTransform}
      >
        <option value="direction">Direction</option>
        <option value="normal">Normal</option>
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
      id="vector-help"
      data-testid="vector-help"
      class="result-orientation-help"
      hidden={!hasActiveVector()}
    >
      Authored vectors are normalized for display; magnitude is not displayed
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
