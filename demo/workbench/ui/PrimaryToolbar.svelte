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
  interface BrowserWindow {
    addEventListener(type: string, listener: (event: unknown) => void): void;
    removeEventListener(type: string, listener: (event: unknown) => void): void;
  }

  let toolbarElement: unknown = $state();
  let openPanel: Panel | undefined = $state();

  $effect(() => {
    if (navigationOpen) openPanel = undefined;
  });

  onMount(() => {
    const browser = Reflect.get(globalThis, "window") as BrowserWindow | undefined;
    if (browser === undefined) return;
    const closeOutside = (event: unknown): void => {
      const target = eventTarget(event);
      if (target !== undefined && !containsTarget(target)) openPanel = undefined;
    };
    const closeWithEscape = (event: unknown): void => {
      if (eventKey(event) !== "Escape" || openPanel === undefined) return;
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
    if (typeof event !== "object" || event === null) return undefined;
    const currentTarget = Reflect.get(event, "currentTarget");
    if (typeof currentTarget !== "object" || currentTarget === null) return undefined;
    const value = Reflect.get(currentTarget, "value");
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

  function eventTarget(event: unknown): object | undefined {
    if (typeof event !== "object" || event === null) return undefined;
    const target = Reflect.get(event, "target");
    return typeof target === "object" && target !== null ? target : undefined;
  }

  function eventKey(event: unknown): string | undefined {
    if (typeof event !== "object" || event === null) return undefined;
    const key = Reflect.get(event, "key");
    return typeof key === "string" ? key : undefined;
  }

  function containsTarget(target: object): boolean {
    if (toolbarElement === null || typeof toolbarElement !== "object") return false;
    const contains = Reflect.get(toolbarElement, "contains");
    return (
      typeof contains === "function" && Reflect.apply(contains, toolbarElement, [target]) === true
    );
  }

  function focusTrigger(panel: Panel): void {
    if (toolbarElement === null || typeof toolbarElement !== "object") return;
    const querySelector = Reflect.get(toolbarElement, "querySelector");
    if (typeof querySelector !== "function") return;
    const element = Reflect.apply(querySelector, toolbarElement, [
      `[aria-controls="${panelId(panel)}"]`,
    ]);
    if (element === null || typeof element !== "object") return;
    const focus = Reflect.get(element, "focus");
    if (typeof focus === "function") Reflect.apply(focus, element, []);
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
      title="Choose whether click and box selection targets elements, faces, nodes, or authored edges."
      value={snapshot?.toolbar.selectionGranularity ?? "element"}
      onchange={setSelectionGranularity}
    >
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
      title="Visible selects nearest visible samples; Through selects intersecting visible elements through occlusion."
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
      disabled={(snapshot?.hierarchy.selectedCount ?? 0) === 0 ||
        snapshot?.toolbar.selectionGranularity === "edge"}
      aria-label={snapshot?.toolbar.selectionGranularity === "edge"
        ? "Hide selected elements unavailable for edge selection"
        : `Hide selected ${snapshot?.hierarchy.selectedCount === 1 ? "element" : "elements"}`}
      title={snapshot?.toolbar.selectionGranularity === "edge"
        ? "Hide selected is available for element selection, not authored edge selection."
        : snapshot?.hierarchy.selectedCount === 0
          ? "Select one or more elements to hide."
          : `Hide ${snapshot?.hierarchy.selectedCount} selected elements.`}
      onclick={() => controller?.commands.hideSelected()}>Hide selected</button
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
    Element: click or drag to replace. Face/Node use the same gesture. Hold Ctrl or ⌘ to toggle.
    Shift keeps element selection. Alt selects an instance. Edge selects authored occurrence-scoped
    topology; shared edges remain edges when Shift is held. Through is unavailable for Edge. Press Z
    to frame the visible selection, or the complete model when none is eligible.
  </p>
</div>
