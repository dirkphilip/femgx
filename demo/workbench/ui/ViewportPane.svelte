<script lang="ts">
  import type { Snippet } from "svelte";

  let {
    secondary = false,
    hidden = false,
    children,
  }: {
    secondary?: boolean;
    hidden?: boolean;
    children?: Snippet;
  } = $props();

  const paneId = $derived(secondary ? "secondary" : "primary");
  const canvasId = $derived(secondary ? "secondary-view" : "view");
  const canvasTestId = $derived(secondary ? "secondary-view-canvas" : "view-canvas");
  const overlayId = $derived(
    secondary ? "secondary-box-selection-overlay" : "box-selection-overlay",
  );
  const overlayTestId = $derived(
    secondary ? "secondary-box-selection-overlay" : "box-selection-overlay",
  );
  const canvasLabel = $derived(
    secondary ? "Secondary finite-element model view" : "Finite-element model view",
  );
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<section
  id={`${paneId}-scene`}
  class={secondary ? "scene-pane" : "scene"}
  aria-label={secondary ? "Secondary viewport" : "Primary viewport"}
  data-pane={paneId}
  tabindex="0"
  {hidden}
>
  <canvas
    id={canvasId}
    data-testid={canvasTestId}
    width="800"
    height="600"
    aria-describedby="interaction-help"
    aria-label={canvasLabel}
  ></canvas>
  <div id={overlayId} data-testid={overlayTestId} aria-hidden="true" hidden></div>
  {@render children?.()}
  <div class="scene-pane-label">{secondary ? "Secondary viewport" : "Primary viewport"}</div>
</section>
