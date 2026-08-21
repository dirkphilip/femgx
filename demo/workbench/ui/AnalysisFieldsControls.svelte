<script lang="ts">
  import { BASE_RESULT_VALUE, DEFORMATION_OFF_VALUE } from "../results/result-controls";
  import type {
    WorkbenchPresentationPort,
    WorkbenchResultField,
    WorkbenchSnapshot,
  } from "../presentation/snapshot";
  import type { WorkbenchResultPlaybackField } from "../results/result-playback";
  import { controlValue } from "./control-value";

  let {
    workbench,
    snapshot,
  }: {
    workbench: WorkbenchPresentationPort | undefined;
    snapshot: WorkbenchSnapshot | undefined;
  } = $props();

  function setResultField(event: unknown): void {
    const value = controlValue(event);
    if (value !== undefined) workbench?.commands.setResultField(value);
  }

  function setDeformationField(event: unknown): void {
    const value = controlValue(event);
    if (value !== undefined) workbench?.commands.setDeformationField(value);
  }

  function setDeformationScale(event: unknown): void {
    const value = controlValue(event);
    if (value !== undefined) workbench?.commands.setDeformationScale(value);
  }

  function fieldLabel(field: WorkbenchResultField): string {
    return `${field.name} · ${field.location === "nodal" ? "Nodal" : "Elemental"}`;
  }

  function playbackFieldLabel(field: WorkbenchResultPlaybackField, stepLabel: string): string {
    return `${field.name} · ${field.location === "nodal" ? "Nodal" : "Elemental"} · Unit ${field.unit} · ${stepLabel}`;
  }

  function hasActiveScalar(): boolean {
    return (
      (snapshot?.analysis.scalarFields.length ?? 0) > 0 &&
      snapshot?.analysis.scalarFieldId !== BASE_RESULT_VALUE &&
      snapshot?.analysis.resultMode !== "base"
    );
  }

  function showDeformationSection(): boolean {
    return hasActiveScalar() && (snapshot?.analysis.deformationFields.length ?? 0) > 0;
  }

  function hasActiveDeformation(): boolean {
    return (
      showDeformationSection() && snapshot?.analysis.deformationFieldId !== DEFORMATION_OFF_VALUE
    );
  }
</script>

<section
  id="result-controls"
  data-testid="result-controls"
  data-analysis-section="scalar"
  class="analysis-section result-controls"
  role="group"
  aria-labelledby="scalar-heading"
  hidden={(snapshot?.analysis.scalarFields.length ?? 0) === 0}
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
