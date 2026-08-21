<script lang="ts">
  import type { WorkbenchPresentationPort, WorkbenchSnapshot } from "../presentation/snapshot";
  import type { SectionAxis } from "../section-controls";
  import { controlValue } from "./control-value";

  let {
    workbench,
    snapshot,
    hasResultFields,
  }: {
    workbench: WorkbenchPresentationPort | undefined;
    snapshot: WorkbenchSnapshot | undefined;
    hasResultFields: boolean;
  } = $props();

  function isSectionAxis(value: string | undefined): value is SectionAxis {
    return value === "off" || value === "x" || value === "y" || value === "z";
  }

  function setSectionAxis(event: unknown): void {
    const value = controlValue(event);
    if (isSectionAxis(value)) workbench?.commands.setSectionAxis(value);
  }

  function setSectionOffset(event: unknown): void {
    const value = controlValue(event);
    if (value !== undefined) workbench?.commands.setSectionOffset(value);
  }

  function formatOffset(value: number): string {
    return String(Math.abs(value) < 1e-9 ? 0 : Number(value.toPrecision(5)));
  }
</script>

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

<p class="analysis-empty" hidden={hasResultFields}>
  This model has no authored result fields. Sectioning remains available.
</p>
