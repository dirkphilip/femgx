<script lang="ts">
  import type { WorkbenchController } from "../controller";
  import type { WorkbenchSnapshot, WorkbenchStartupStatus } from "../snapshot";
  import ContextMenu from "./ContextMenu.svelte";
  import PrimaryToolbar from "./PrimaryToolbar.svelte";
  import ResultLegend from "./ResultLegend.svelte";
  import StatusOverlays from "./StatusOverlays.svelte";
  import TouchToolRail from "./TouchToolRail.svelte";
  import ViewportPane from "./ViewportPane.svelte";

  let {
    controller,
    snapshot,
    startup,
    navigationOpen = false,
  }: {
    controller: WorkbenchController | undefined;
    snapshot: WorkbenchSnapshot | undefined;
    startup: WorkbenchStartupStatus | undefined;
    navigationOpen?: boolean;
  } = $props();
</script>

<div id="viewport-shell" aria-hidden={navigationOpen}>
  <PrimaryToolbar {controller} {snapshot} {navigationOpen} />
  <div id="viewport-workspace" data-secondary-open={snapshot?.toolbar.secondaryOpen ?? false}>
    <ViewportPane>
      <ResultLegend {snapshot} />
      <StatusOverlays {snapshot} {startup} />
    </ViewportPane>
    <ViewportPane secondary hidden={!(snapshot?.toolbar.secondaryOpen ?? false)} />
    <TouchToolRail {controller} {snapshot} />
  </div>
</div>

<ContextMenu {controller} {snapshot} />
