<script lang="ts">
  import type { WorkbenchController } from "../controllers/controller";
  import type { WorkbenchSnapshot, WorkbenchStartupStatus } from "../results/snapshot";
  import ContextMenu from "./ContextMenu";
  import PrimaryToolbar from "./PrimaryToolbar";
  import ResultLegend from "./ResultLegend";
  import StatusOverlays from "./StatusOverlays";
  import TouchToolRail from "./TouchToolRail";
  import ViewportPane from "./ViewportPane";

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
