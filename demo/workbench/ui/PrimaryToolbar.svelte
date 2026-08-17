<script lang="ts">
  import { onMount } from "svelte";
  import type { WorkbenchController } from "../controllers/controller";
  import type { WorkbenchSnapshot } from "../results/snapshot";
  import AnalysisControls from "./AnalysisControls.svelte";

  let {
    controller,
    snapshot,
    navigationOpen = false,
  }: {
    controller: WorkbenchController | undefined;
    snapshot: WorkbenchSnapshot | undefined;
    navigationOpen?: boolean;
  } = $props();

  type Panel = "selection" | "view" | "display" | "analysis";
  let toolbarElement: HTMLDivElement | undefined = $state();
  let openPanel: Panel | undefined = $state();

  $effect(() => {
    if (navigationOpen) openPanel = undefined;
  });

  onMount(() => {
    const browser = globalThis.window;
    const closeOutside = (event: PointerEvent): void => {
      if (!(event.target instanceof Node) || !containsTarget(event.target)) openPanel = undefined;
    };
    const closeWithEscape = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || openPanel === undefined) return;
      const panel = openPanel;
      openPanel = undefined;
      focusTrigger(panel);
    };
    browser.addEventListener("pointerdown", closeOutside);
    browser.addEventListener("keydown", closeWithEscape);
    return () => {
      browser.removeEventListener("pointerdown", closeOutside);
      browser.removeEventListener("keydown", closeWithEscape);
    };
  });

  function togglePanel(panel: Panel): void {
    openPanel = openPanel === panel ? undefined : panel;
  }

  function isOpen(panel: Panel): boolean {
    return openPanel === panel;
  }

  function panelId(panel: Panel): string {
    return `${panel}-controls`;
  }

  function selectValue(event: unknown): string | undefined {
    if (typeof event !== "object" || event === null || !("currentTarget" in event)) {
      return undefined;
    }
    const currentTarget = event.currentTarget;
    if (
      typeof currentTarget !== "object" ||
      currentTarget === null ||
      !("value" in currentTarget)
    ) {
      return undefined;
    }
    const value = currentTarget.value;
    return typeof value === "string" ? value : undefined;
  }

  function setBackground(event: unknown): void {
    const value = selectValue(event);
    if (value !== undefined) controller?.commands.setBackground(value);
  }

  function setSelectionGranularity(event: unknown): void {
    const value = selectValue(event);
    if (value !== undefined) controller?.commands.setSelectionGranularity(value);
  }

  function setBoxSelectionStrategy(event: unknown): void {
    const value = selectValue(event);
    if (value !== undefined) controller?.commands.setBoxSelectionStrategy(value);
  }

  function containsTarget(target: Node): boolean {
    return toolbarElement?.contains(target) ?? false;
  }

  function focusTrigger(panel: Panel): void {
    toolbarElement?.querySelector<HTMLElement>(`[aria-controls="${panelId(panel)}"]`)?.focus();
  }
</script>

<div bind:this={toolbarElement} class="toolbar" role="toolbar" aria-label="Viewport commands">
  <div class="command-bar">
    <button
      id="command-selection"
      type="button"
      class="command-target"
      data-testid="command-selection"
      aria-expanded={isOpen("selection")}
      aria-controls={panelId("selection")}
      onclick={() => togglePanel("selection")}>Selection</button
    >
    <button
      id="command-view"
      type="button"
      class="command-target"
      data-testid="command-view"
      aria-expanded={isOpen("view")}
      aria-controls={panelId("view")}
      onclick={() => togglePanel("view")}>View</button
    >
    <button
      id="command-display"
      type="button"
      class="command-target"
      data-testid="command-display"
      aria-expanded={isOpen("display")}
      aria-controls={panelId("display")}
      onclick={() => togglePanel("display")}>Display</button
    >
    <button
      id="command-analysis"
      type="button"
      class="command-target"
      data-testid="command-analysis"
      aria-expanded={isOpen("analysis")}
      aria-controls={panelId("analysis")}
      onclick={() => togglePanel("analysis")}>Analysis</button
    >
  </div>

  <section
    id="selection-controls"
    class="command-panel"
    role="group"
    aria-labelledby="command-selection"
    hidden={!isOpen("selection")}
  >
    <div class="command-panel-heading">Selection</div>
    <select
      id="selection-granularity"
      data-testid="selection-granularity"
      aria-label="Selection granularity"
      aria-describedby="interaction-help"
      title="Choose whether point and box selection targets parts, instances, bodies, elements, faces, nodes, or authored edges."
      value={snapshot?.toolbar.selectionGranularity ?? "element"}
      onchange={setSelectionGranularity}
    >
      <option value="part">Part</option>
      <option value="instance">Instance</option>
      <option value="body">Body</option>
      <option value="element">Element</option>
      <option value="face">Face</option>
      <option value="node">Node</option>
      <option value="edge">Edge</option>
    </select>
    <select
      id="box-selection-strategy"
      data-testid="box-selection-strategy"
      aria-label="Box selection"
      aria-describedby="interaction-help"
      title="Visible selects nearest visible samples at the active granularity; Through selects intersecting visible elements through occlusion and is available only for Element."
      value={snapshot?.toolbar.boxSelectionStrategy ?? "visible-surface"}
      onchange={setBoxSelectionStrategy}
    >
      <option value="visible-surface">Visible</option>
      <option
        value="through-intersection"
        disabled={snapshot?.toolbar.selectionGranularity !== "element"}>Through</option
      >
    </select>
    <button
      id="select-all"
      data-testid="select-all"
      type="button"
      title="Select every explicitly visible target at the active granularity."
      onclick={() => controller?.commands.selectAll()}>Select all</button
    >
    <button
      id="hide-selected"
      data-testid="hide-selected"
      type="button"
      disabled={(snapshot?.hierarchy.hideSelectedElementCount ?? 0) === 0}
      aria-label={(snapshot?.hierarchy.hideSelectedElementCount ?? 0) === 0
        ? "Hide selected elements unavailable"
        : `Hide selected ${snapshot?.hierarchy.hideSelectedElementCount === 1 ? "element" : "elements"}`}
      title={(snapshot?.hierarchy.hideSelectedElementCount ?? 0) === 0
        ? "Select one or more visible elements to hide."
        : `Hide ${snapshot?.hierarchy.hideSelectedElementCount} selected visible element${snapshot?.hierarchy.hideSelectedElementCount === 1 ? "" : "s"}.`}
      onclick={() => controller?.commands.hideSelected()}>Hide selected</button
    >
    <button
      id="clear-selection"
      data-testid="clear-selection"
      type="button"
      disabled={(snapshot?.hierarchy.selectedCount ?? 0) === 0}
      title={(snapshot?.hierarchy.selectedCount ?? 0) === 0
        ? "No selection to clear."
        : "Clear selection without changing visibility, results, or camera."}
      onclick={() => controller?.commands.clearSelection()}>Clear selection</button
    >
    <button
      id="show-all"
      data-testid="show-all"
      type="button"
      title="Restore all model visibility without clearing selection or changing the camera."
      onclick={() => controller?.commands.showAll()}>Show all</button
    >
  </section>

  <section
    id="view-controls"
    class="command-panel"
    role="group"
    aria-labelledby="command-view"
    hidden={!isOpen("view")}
  >
    <div class="command-panel-heading">View</div>
    <button
      id="fit-view"
      data-testid="fit-view"
      type="button"
      aria-label={snapshot?.toolbar.fitSelectionAvailable ? "Fit selection" : "Fit model"}
      aria-keyshortcuts="Z"
      title={snapshot?.toolbar.fitSelectionAvailable
        ? "Frame the visible selected geometry. Press Z to use the same action."
        : "Frame the complete model because no visible selection can be framed. Press Z to use the same action."}
      onclick={() => controller?.commands.fitSelection()}
      >{snapshot?.toolbar.fitSelectionAvailable ? "Fit selection" : "Fit model"}</button
    >
    <button
      id="projection-toggle"
      data-testid="projection-toggle"
      type="button"
      aria-label={`Projection: ${snapshot?.toolbar.projection ?? "perspective"}`}
      onclick={() => controller?.commands.setProjection()}
      >{snapshot?.toolbar.projection === "orthographic" ? "Orthographic" : "Perspective"}</button
    >
    <label class="toolbar-background" for="background-select">
      <span class="toolbar-background-name">Background</span>
      <select
        id="background-select"
        data-testid="background-select"
        aria-label="Background"
        value={snapshot?.toolbar.background ?? "studio"}
        onchange={setBackground}
      >
        <option value="studio">Studio</option>
        <option value="white">White</option>
        <option value="dark">Dark</option>
      </select>
    </label>
    <button
      id="viewport-toggle"
      data-testid="viewport-toggle"
      type="button"
      aria-pressed={snapshot?.toolbar.secondaryOpen ?? false}
      aria-label={snapshot?.toolbar.secondaryOpen
        ? "Close secondary viewport"
        : "Add secondary viewport"}
      disabled={snapshot?.toolbar.secondaryBusy ?? false}
      onclick={() => controller?.commands.toggleSecondaryViewport()}
      >{snapshot?.toolbar.secondaryBusy
        ? "Opening…"
        : snapshot?.toolbar.secondaryOpen
          ? "Close viewport"
          : "Add viewport"}</button
    >
  </section>

  <section
    id="display-controls"
    class="command-panel"
    role="group"
    aria-labelledby="command-display"
    hidden={!isOpen("display")}
  >
    <div class="command-panel-heading">Display</div>
    <button
      id="edge-overlay"
      data-testid="edge-overlay"
      type="button"
      aria-pressed={snapshot?.toolbar.edges ?? true}
      onclick={() => controller?.commands.toggleEdges()}>Edges</button
    >
    <button
      id="node-overlay"
      data-testid="node-overlay"
      type="button"
      aria-pressed={snapshot?.toolbar.nodes ?? true}
      title="Toggle node annotations. Point elements use their primary glyph as the node marker."
      onclick={() => controller?.commands.toggleNodes()}>Nodes</button
    >
    <button
      id="continuous-rendering"
      data-testid="continuous-rendering"
      type="button"
      aria-pressed={snapshot?.toolbar.continuous ?? false}
      title="Start a recurring render-loop sample for manual inspection."
      onclick={() => controller?.commands.toggleContinuous()}>Continuous</button
    >
  </section>

  <section
    id="analysis-controls"
    data-testid="analysis-controls"
    class="command-panel command-panel-analysis"
    role="group"
    aria-labelledby="command-analysis"
    hidden={!isOpen("analysis")}
  >
    <AnalysisControls {controller} {snapshot} />
  </section>

  <div
    id="model-feedback"
    data-testid="model-feedback"
    role="status"
    aria-live="polite"
    data-kind={snapshot?.overlays.feedback?.kind}
    hidden={snapshot?.overlays.feedback === undefined}
  >
    {snapshot?.overlays.feedback?.message ?? ""}
  </div>
  <p id="interaction-help" data-testid="interaction-help" class="interaction-help">
    Part/Instance/Body/Element/Face/Node use the same gesture. Hold Ctrl or ⌘ to toggle a click or
    append a box. Shift promotes Face/Node to the owning element. Alt selects an instance from any
    mode. Edge selects authored occurrence-scoped topology; shared edges remain edges when Shift is
    held. Through is available only for Element. Point elements use their primary glyph as the node
    marker, whether Nodes is enabled or hidden. Press Z to frame the visible selection, or the
    complete model when none is eligible.
  </p>
</div>
