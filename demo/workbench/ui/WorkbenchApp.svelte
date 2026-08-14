<script lang="ts">
  import { onDestroy } from "svelte";
  import type { WorkbenchController } from "../controller";
  import type { WorkbenchSnapshot } from "../snapshot";
  import PrimaryToolbar from "./PrimaryToolbar.svelte";

  let controller: WorkbenchController | undefined = $state();
  let snapshot: WorkbenchSnapshot | undefined = $state();
  let unsubscribe: (() => void) | undefined;

  /** Connects the presentation root to the already-created plain TypeScript owner. */
  export function connectWorkbench(next: WorkbenchController): void {
    unsubscribe?.();
    controller = next;
    unsubscribe = next.subscribe((current) => {
      snapshot = current;
    });
  }

  onDestroy(() => {
    unsubscribe?.();
  });
</script>

<main class="app">
  <aside class="sidebar">
    <div class="brand">
      <h1>FemGx</h1>
      <p class="subtitle">FE inspection</p>
      <a class="brand-link" href="./api/">API reference</a>
      <div id="build-info" class="build-info" data-testid="build-info"></div>
    </div>
    <h2 class="sidebar-heading">Visibility</h2>
    <div id="visibility-panel" data-testid="visibility-panel"></div>
  </aside>
  <div id="viewport-workspace" data-secondary-open="false">
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <section
      id="primary-scene"
      class="scene"
      aria-label="Primary viewport"
      data-pane="primary"
      tabindex="0"
    >
      <canvas
        id="view"
        data-testid="view-canvas"
        width="800"
        height="600"
        aria-describedby="interaction-help"
        aria-label="Finite-element model view"
      ></canvas>
      <div
        id="box-selection-overlay"
        data-testid="box-selection-overlay"
        aria-hidden="true"
        hidden
      ></div>
      <PrimaryToolbar {controller} {snapshot} />
      <div class="hud inspection" hidden>
        <h2>Inspection</h2>
        <pre id="inspection-panel" data-testid="inspection-panel"></pre>
      </div>
      <section
        id="result-legend"
        data-testid="result-legend"
        class="hud result-legend"
        aria-label="Active result legend"
        hidden
      ></section>
      <div id="renderer-status" data-testid="renderer-status" class="renderer-alert" hidden></div>
      <div id="status" data-testid="status" class="status-alert" hidden></div>
      <section
        id="stats-panel"
        data-testid="stats-panel"
        class="hud diagnostics"
        aria-labelledby="diagnostics-heading"
        hidden
      >
        <h2 id="diagnostics-heading">Diagnostics</h2>
        <pre id="diagnostics-content"></pre>
      </section>
      <div class="scene-pane-label">Primary viewport</div>
    </section>
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <section
      id="secondary-scene"
      class="scene-pane"
      aria-label="Secondary viewport"
      data-pane="secondary"
      tabindex="0"
      hidden
    >
      <canvas
        id="secondary-view"
        data-testid="secondary-view-canvas"
        width="800"
        height="600"
        aria-describedby="interaction-help"
        aria-label="Secondary finite-element model view"
      ></canvas>
      <div
        id="secondary-box-selection-overlay"
        data-testid="secondary-box-selection-overlay"
        aria-hidden="true"
        hidden
      ></div>
      <div class="scene-pane-label">Secondary viewport</div>
    </section>
  </div>
  <div id="context-menu" class="context-menu" data-testid="context-menu" hidden></div>
</main>
