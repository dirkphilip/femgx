<script lang="ts">
  import type {
    WorkbenchPresentationPort,
    WorkbenchSnapshot,
    WorkbenchStartupStatus,
  } from "../presentation/snapshot";
  import ContextMenu from "./ContextMenu.svelte";
  import PrimaryToolbar from "./PrimaryToolbar.svelte";
  import ResultLegend from "./ResultLegend.svelte";
  import StatusOverlays from "./StatusOverlays.svelte";
  import TouchToolRail from "./TouchToolRail.svelte";
  import LivePartDialog from "./LivePartDialog.svelte";
  import ViewportPane from "./ViewportPane.svelte";

  let {
    workbench,
    snapshot,
    startup,
    navigationOpen = false,
  }: {
    workbench: WorkbenchPresentationPort | undefined;
    snapshot: WorkbenchSnapshot | undefined;
    startup: WorkbenchStartupStatus | undefined;
    navigationOpen?: boolean;
  } = $props();
</script>

<div id="viewport-shell" aria-hidden={navigationOpen}>
  <PrimaryToolbar {workbench} {snapshot} {navigationOpen} />
  <div
    id="viewport-workspace"
    data-secondary-open={snapshot?.toolbar.secondaryOpen ?? false}
    data-active-slot={snapshot?.toolbar.activeSlot ?? "primary"}
  >
    <ViewportPane>
      {#if snapshot?.toolbar.activeSlot !== "secondary"}
        <StatusOverlays {snapshot} {startup} />
      {/if}
    </ViewportPane>
    <ViewportPane secondary hidden={!(snapshot?.toolbar.secondaryOpen ?? false)}>
      {#if snapshot?.toolbar.activeSlot === "secondary"}
        <StatusOverlays {snapshot} {startup} />
      {/if}
    </ViewportPane>
    <ResultLegend {snapshot} />
    <TouchToolRail {workbench} {snapshot} />
  </div>
</div>

<ContextMenu {workbench} {snapshot} />
<LivePartDialog {workbench} {snapshot} />
