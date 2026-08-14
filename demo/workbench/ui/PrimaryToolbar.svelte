<script lang="ts">
  import type { WorkbenchController } from "../controller";
  import type { WorkbenchSnapshot } from "../snapshot";
  import AnalysisControls from "./AnalysisControls.svelte";

  let {
    controller,
    snapshot,
  }: {
    controller: WorkbenchController | undefined;
    snapshot: WorkbenchSnapshot | undefined;
  } = $props();

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
</script>

<div class="toolbar">
  <div class="toolbar-row toolbar-row-primary">
    <div id="model-source" class="model-source" role="group" aria-label="Model source">
      <select id="model-select" data-testid="model-select" aria-label="Example model"></select>
      <button id="open-model" data-testid="open-model" type="button">Open model…</button>
      <input
        id="model-file"
        data-testid="model-file"
        class="visually-hidden"
        type="file"
        accept=".vtk,.glb,text/plain,model/gltf-binary"
        tabindex="-1"
      />
    </div>
    <button
      id="fit-view"
      data-testid="fit-view"
      type="button"
      aria-label="Fit model"
      title="Frame the complete model without changing visibility, selection, display, results, or projection."
      onclick={() => controller?.commands.fitView()}>Fit model</button
    >
    <select
      id="selection-granularity"
      data-testid="selection-granularity"
      aria-label="Selection granularity"
      aria-describedby="interaction-help"
      title="Choose whether click and box selection targets elements, faces, or nodes."
      value={snapshot?.toolbar.selectionGranularity ?? "element"}
      onchange={setSelectionGranularity}
    >
      <option value="element">Element</option>
      <option value="face">Face</option>
      <option value="node">Node</option>
    </select>
    <button
      id="hide-selected"
      data-testid="hide-selected"
      type="button"
      disabled={(snapshot?.hierarchy.selectedCount ?? 0) === 0}
      aria-label={`Hide selected ${snapshot?.hierarchy.selectedCount === 1 ? "element" : "elements"}`}
      title={snapshot?.hierarchy.selectedCount === 0
        ? "Select one or more elements to hide."
        : `Hide ${snapshot?.hierarchy.selectedCount} selected elements.`}
      onclick={() => controller?.commands.hideSelected()}
      >{snapshot?.hierarchy.selectedCount === 0
        ? "Hide selected"
        : `Hide selected (${snapshot?.hierarchy.selectedCount})`}</button
    >
    <button
      id="show-all"
      data-testid="show-all"
      type="button"
      aria-label="Show all"
      title="Restore all model visibility without changing selection or display settings."
      onclick={() => controller?.commands.showAll()}>Show all</button
    >
    <button
      id="viewport-toggle"
      data-testid="viewport-toggle"
      type="button"
      aria-pressed="false"
      aria-label="Add secondary viewport">Add viewport</button
    >
    <button
      id="projection-toggle"
      data-testid="projection-toggle"
      type="button"
      aria-label={`Projection: ${snapshot?.toolbar.projection ?? "perspective"}`}
      onclick={() => controller?.commands.setProjection()}
      >{snapshot?.toolbar.projection === "orthographic" ? "Orthographic" : "Perspective"}</button
    >
  </div>
  <div class="toolbar-row toolbar-row-secondary">
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
    <AnalysisControls {controller} {snapshot} />
    <button
      id="reset"
      data-testid="reset"
      class="secondary"
      type="button"
      aria-label="Reset all"
      title="Restore this model's initial visibility, selection, display, results, projection, and camera."
      onclick={() => controller?.commands.reset()}>Reset all</button
    >
  </div>
  <div
    id="model-feedback"
    data-testid="model-feedback"
    role="status"
    aria-live="polite"
    hidden
  ></div>
  <p id="interaction-help" data-testid="interaction-help" class="interaction-help">
    Element: click or drag to replace. Hold Ctrl or ⌘ to toggle. Shift keeps element selection. Alt
    selects an instance.
  </p>
</div>
