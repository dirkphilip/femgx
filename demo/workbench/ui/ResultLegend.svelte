<script lang="ts">
  import type { WorkbenchSnapshot } from "../snapshot";

  let { snapshot }: { snapshot: WorkbenchSnapshot | undefined } = $props();
</script>

<section
  id="result-legend"
  data-testid="result-legend"
  class="hud result-legend"
  aria-label="Active result legend"
  hidden={!(snapshot?.overlays.resultLegend.visible ?? false)}
>
  {snapshot?.overlays.resultLegend.text ?? ""}
</section>
