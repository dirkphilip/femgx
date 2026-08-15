<script lang="ts">
  import type { WorkbenchSnapshot, WorkbenchStartupStatus } from "../snapshot";

  let {
    snapshot,
    startup,
  }: {
    snapshot: WorkbenchSnapshot | undefined;
    startup: WorkbenchStartupStatus | undefined;
  } = $props();
</script>

<div
  id="renderer-status"
  data-testid="renderer-status"
  class="renderer-alert"
  hidden={startup === undefined && !(snapshot?.overlays.rendererStatusVisible ?? false)}
>
  {startup?.rendererStatus ?? snapshot?.overlays.rendererStatus ?? ""}
</div>
<div
  id="status"
  data-testid="status"
  class="status-alert"
  hidden={startup === undefined && !(snapshot?.overlays.statusVisible ?? false)}
>
  {startup?.status ?? snapshot?.overlays.status ?? ""}
</div>
<div class="hud inspection" hidden={!(snapshot?.overlays.inspection.visible ?? false)}>
  <h2>Inspection</h2>
  <pre id="inspection-panel" data-testid="inspection-panel">
{snapshot?.overlays.inspection.text ??
      "Click or right-click a visible element, face, node, or authored edge to inspect it."}</pre>
</div>
<section
  id="stats-panel"
  data-testid="stats-panel"
  class="hud diagnostics"
  aria-labelledby="diagnostics-heading"
  hidden={!(snapshot?.overlays.diagnostics ?? false)}
>
  <h2 id="diagnostics-heading">Diagnostics</h2>
  <pre id="diagnostics-content">{snapshot?.overlays.diagnosticsText ?? ""}</pre>
</section>
