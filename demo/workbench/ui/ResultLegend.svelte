<script lang="ts">
  import type { WorkbenchSnapshot } from "../snapshot";

  let { snapshot }: { snapshot: WorkbenchSnapshot | undefined } = $props();

  function hasScalarLegend(): boolean {
    return snapshot?.overlays.resultLegend.text.includes("Range ") ?? false;
  }
</script>

<section
  id="result-legend"
  data-testid="result-legend"
  class={`hud result-legend ${hasScalarLegend() ? "result-legend-with-ramp" : ""}`}
  aria-label="Active result legend"
  hidden={!(snapshot?.overlays.resultLegend.visible ?? false)}
>
  {#if hasScalarLegend()}<span class="result-legend-ramp" aria-hidden="true"></span>{/if}
  <span class="result-legend-text">{snapshot?.overlays.resultLegend.text ?? ""}</span>
</section>
