<script lang="ts">
  import type { WorkbenchSnapshot } from "../results/snapshot";
  import type { WorkbenchResultLegendSnapshot } from "../results/result-legend";
  import { vectorGlyphLabel, vectorTransformLabel } from "../results/result-controls";

  let { snapshot }: { snapshot: WorkbenchSnapshot | undefined } = $props();

  function formatNumber(value: number): string {
    return String(Math.abs(value) < 1e-9 ? 0 : Number(value.toPrecision(5)));
  }

  function locationLabel(location: "nodal" | "elemental"): string {
    return location === "nodal" ? "Nodal" : "Elemental";
  }

  function colorCss(color: Readonly<{ r: number; g: number; b: number; a: number }>): string {
    return `rgba(${Math.round(color.r * 255)}, ${Math.round(color.g * 255)}, ${Math.round(color.b * 255)}, ${color.a})`;
  }

  function paletteStyle(scalar: NonNullable<WorkbenchResultLegendSnapshot["scalar"]>): string {
    const stops = scalar.palette
      .map((stop) => `${colorCss(stop.color)} ${stop.offset * 100}%`)
      .join(", ");
    return `background: linear-gradient(90deg, ${stops})`;
  }

  function hasActiveSection(): boolean {
    return (
      snapshot?.overlays.resultLegend.section.axis !== undefined &&
      snapshot.overlays.resultLegend.section.axis !== "off"
    );
  }
</script>

<section
  id="result-legend"
  data-testid="result-legend"
  class="hud result-legend"
  aria-label="Active result summary"
  hidden={!(snapshot?.overlays.resultLegend.visible ?? false)}
>
  <div class="result-legend-heading">Analysis summary</div>
  {#if snapshot?.overlays.resultLegend.scalar}
    {@const scalar = snapshot.overlays.resultLegend.scalar}
    <div id="result-legend-scalar" data-testid="result-legend-scalar" class="legend-role">
      <strong>{scalar.field.name}</strong>
      <span>{locationLabel(scalar.field.location)} · Unit {scalar.field.unit}</span>
      <span>Range {formatNumber(scalar.range.min)} – {formatNumber(scalar.range.max)}</span>
      <span
        class="result-legend-ramp"
        role="img"
        aria-label="Scalar color palette"
        style={paletteStyle(scalar)}
      ></span>
    </div>
  {/if}
  {#if snapshot?.overlays.resultLegend.deformation}
    {@const deformation = snapshot.overlays.resultLegend.deformation}
    <div id="result-legend-deformation" data-testid="result-legend-deformation" class="legend-role">
      <strong>Deformation</strong>
      <span
        >{deformation.field.name} · {locationLabel(deformation.field.location)} · Unit {deformation
          .field.unit}</span
      >
      <span>Scale {formatNumber(deformation.scale)}</span>
    </div>
  {/if}
  {#if snapshot?.overlays.resultLegend.orientation}
    {@const orientation = snapshot.overlays.resultLegend.orientation}
    <div id="result-legend-orientation" data-testid="result-legend-orientation" class="legend-role">
      <strong>Orientation</strong>
      <span
        >{orientation.field.name} · {locationLabel(orientation.field.location)} · Unit {orientation
          .field.unit}</span
      >
      <span
        >{vectorGlyphLabel(orientation.glyph)} · {vectorTransformLabel(orientation.transform)} · Scale
        {formatNumber(orientation.lengthScale)} · Width {formatNumber(orientation.widthPixels)} CSS px</span
      >
      {#if orientation.glyph === "triad"}
        <span>RGB lines show the authored positive X/Y/Z axes at each element anchor</span>
        <span>Complete part-local frames follow every occurrence of the reusable part</span>
        <span>Frame axes normalized for display · Not pick targets</span>
      {:else}
        <span>Arrow preserves sign at the element anchor; Axis is centered and sign-invariant</span>
        <span
          >Spatial direction follows occurrence transforms; Surface normal uses inverse-transpose</span
        >
        <span>Authored vectors normalized for display · Magnitude not displayed</span>
      {/if}
      <span>Faded fragments are behind opaque model geometry</span>
    </div>
  {/if}
  {#if snapshot && hasActiveSection()}
    <div id="result-legend-section" data-testid="result-legend-section" class="legend-role">
      <strong>Section</strong>
      <span>Keep +{snapshot.overlays.resultLegend.section.axis.toUpperCase()}</span>
      <span>Offset {formatNumber(snapshot.overlays.resultLegend.section.offset)}</span>
    </div>
  {/if}
</section>
