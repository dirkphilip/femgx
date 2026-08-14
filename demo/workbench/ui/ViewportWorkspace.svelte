<script lang="ts">
  import type { WorkbenchController } from "../controller";
  import type { WorkbenchSnapshot, WorkbenchStartupStatus } from "../snapshot";
  import ContextMenu from "./ContextMenu.svelte";
  import PrimaryToolbar from "./PrimaryToolbar.svelte";
  import ResultLegend from "./ResultLegend.svelte";
  import StatusOverlays from "./StatusOverlays.svelte";
  import ViewportPane from "./ViewportPane.svelte";

  let {
    controller,
    snapshot,
    startup,
  }: {
    controller: WorkbenchController | undefined;
    snapshot: WorkbenchSnapshot | undefined;
    startup: WorkbenchStartupStatus | undefined;
  } = $props();
</script>

<div id="viewport-workspace" data-secondary-open={snapshot?.toolbar.secondaryOpen ?? false}>
  <ViewportPane>
    <PrimaryToolbar {controller} {snapshot} />
    <ResultLegend {snapshot} />
    <StatusOverlays {snapshot} {startup} />
  </ViewportPane>
  <ViewportPane secondary hidden={!(snapshot?.toolbar.secondaryOpen ?? false)} />
</div>

<ContextMenu {controller} {snapshot} />
