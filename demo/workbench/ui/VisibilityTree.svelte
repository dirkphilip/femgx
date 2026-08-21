<script lang="ts">
  import { onMount } from "svelte";
  import type { WorkbenchPresentationPort } from "../presentation/snapshot";
  import type {
    WorkbenchVisibilityRowSnapshot,
    WorkbenchVisibilitySnapshot,
  } from "../state/visibility-snapshot";

  let {
    workbench,
    visibility,
  }: {
    workbench: WorkbenchPresentationPort | undefined;
    visibility: WorkbenchVisibilitySnapshot | undefined;
  } = $props();

  const ROW_HEIGHT = 30;
  const OVERSCAN = 8;
  let panelElement: { clientHeight: number; scrollTop: number } | undefined = $state();
  let scrollTop = $state(0);
  let viewportHeight = $state(300);

  let rowWindow = $derived.by(() => {
    const rows = visibility?.rows.filter((row) => !row.hidden) ?? [];
    const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
    const end = Math.min(
      rows.length,
      Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN,
    );
    return {
      rows: rows.slice(start, end),
      top: start * ROW_HEIGHT,
      bottom: Math.max(0, rows.length - end) * ROW_HEIGHT,
    };
  });

  onMount(() => {
    const updateViewport = (): void => {
      if (panelElement !== undefined && panelElement.clientHeight > 0) {
        viewportHeight = panelElement.clientHeight;
      }
    };
    updateViewport();
    globalThis.addEventListener("resize", updateViewport);
    return () => globalThis.removeEventListener("resize", updateViewport);
  });

  function updateScroll(event: { currentTarget: unknown }): void {
    const element = event.currentTarget;
    if (element !== null && typeof element === "object" && "scrollTop" in element) {
      const value = Reflect.get(element, "scrollTop");
      if (typeof value === "number") scrollTop = value;
    }
  }

  function toggleVisibility(row: WorkbenchVisibilityRowSnapshot): void {
    workbench?.commands.toggleVisibility(row.target);
  }

  function selectRow(row: WorkbenchVisibilityRowSnapshot): void {
    workbench?.commands.selectVisibilityTarget(row.target);
  }

  function toggleBodyHighlight(row: WorkbenchVisibilityRowSnapshot): void {
    if (row.target.kind === "body") workbench?.commands.toggleBodyHighlight(row.target);
  }

  function openElementDetail(row: WorkbenchVisibilityRowSnapshot): void {
    if (row.target.kind === "body") workbench?.commands.openElementDetail(row.target);
  }

  function toggleExpanded(row: WorkbenchVisibilityRowSnapshot): void {
    if (row.target.kind === "assemblyOccurrence") {
      workbench?.commands.toggleVisibilityTree(row.target.assemblyOccurrenceId);
    }
  }

  function setPage(page: number): void {
    workbench?.commands.setVisibilityPage(page);
  }

  function setHierarchyHover(row: WorkbenchVisibilityRowSnapshot): void {
    workbench?.commands.setHierarchyHover(row.target);
  }

  function clearHierarchyHover(row: WorkbenchVisibilityRowSnapshot): void {
    workbench?.commands.clearHierarchyHover(row.target);
  }

  function bodyId(row: WorkbenchVisibilityRowSnapshot): number | undefined {
    return row.target.kind === "body" ? row.target.bodyId : undefined;
  }

  function bodyPartOccurrenceId(row: WorkbenchVisibilityRowSnapshot): string | undefined {
    return row.target.kind === "body" ? row.target.partOccurrenceId : undefined;
  }

  function rowClass(row: WorkbenchVisibilityRowSnapshot): string {
    return row.kind === "partOccurrence" ? "part" : row.kind;
  }
</script>

<div
  id="visibility-panel"
  data-testid="visibility-panel"
  role="tree"
  aria-label="Visibility hierarchy"
  bind:this={panelElement}
  onscroll={updateScroll}
>
  {#if visibility !== undefined}
    <div class="visibility-context" data-testid="visibility-context">{visibility.context}</div>
    {#if visibility.pageCount > 1}
      <div class="visibility-pages" aria-label="Visibility hierarchy pages">
        <button
          type="button"
          data-testid="visibility-page-previous"
          disabled={visibility.page === 0}
          onclick={() => setPage(visibility.page - 1)}>Previous</button
        >
        <span data-testid="visibility-page-status"
          >Page {visibility.page + 1} of {visibility.pageCount}</span
        >
        <button
          type="button"
          data-testid="visibility-page-next"
          disabled={visibility.page + 1 >= visibility.pageCount}
          onclick={() => setPage(visibility.page + 1)}>Next</button
        >
      </div>
    {/if}
    <div
      class="visibility-virtual-spacer"
      style={`height: ${rowWindow.top}px`}
      aria-hidden="true"
    ></div>
    {#each rowWindow.rows as row (row.key)}
      <div
        class={`visibility-row visibility-${rowClass(row)}`}
        style={`--visibility-depth: ${row.depth}`}
        hidden={row.hidden}
        role="treeitem"
        data-visibility-target-kind={row.kind}
        data-visibility-target-part-occurrence-id={row.target.kind === "assemblyOccurrence"
          ? undefined
          : row.target.partOccurrenceId}
        data-visibility-target-occurrence-id={row.target.kind === "assemblyOccurrence"
          ? row.target.assemblyOccurrenceId
          : undefined}
        data-visibility-target-body-id={row.target.kind === "body" ? row.target.bodyId : undefined}
        aria-level={row.depth}
        aria-posinset={row.position}
        aria-setsize={row.setSize}
        aria-checked={row.checked}
        aria-hidden={row.hidden}
        aria-selected={row.selected}
        tabindex="-1"
        aria-expanded={row.kind === "assembly" ? row.expanded : undefined}
        onpointerenter={() => setHierarchyHover(row)}
        onpointerleave={() => clearHierarchyHover(row)}
        onfocusin={() => setHierarchyHover(row)}
        onfocusout={() => clearHierarchyHover(row)}
      >
        {#if row.kind === "assembly"}
          <button
            type="button"
            class="visibility-expander"
            data-testid={`assembly-expand-${row.testId.replace("assembly-occurrence-vis-", "")}`}
            aria-expanded={row.expanded}
            aria-label={`${row.expanded ? "Collapse" : "Expand"} ${row.label}`}
            disabled={!row.expandable}
            onclick={() => toggleExpanded(row)}>{row.expanded ? "▾" : "▸"}</button
          >
        {:else}
          <span
            class:visibility-body-spacer={row.kind === "body"}
            class="visibility-spacer"
            aria-hidden="true"
          ></span>
        {/if}
        <label>
          <input
            type="checkbox"
            checked={row.checked}
            disabled={row.disabled}
            data-testid={row.testId}
            data-assembly-occurrence-id={row.target.kind === "assemblyOccurrence"
              ? row.target.assemblyOccurrenceId
              : undefined}
            data-part-occurrence-id={row.target.kind === "partOccurrence"
              ? row.target.partOccurrenceId
              : undefined}
            data-body-id={bodyId(row)}
            data-body-part-occurrence-id={bodyPartOccurrenceId(row)}
            aria-label={row.ariaLabel}
            onchange={() => toggleVisibility(row)}
          />
          <span class="visibility-kind">{row.badge}</span>
          {#if row.kind !== "body"}
            <span class="visibility-label" title={row.label}>{row.label}</span>
          {/if}
        </label>
        <button
          type="button"
          class="visibility-select"
          data-testid={`visibility-select-${row.testId}`}
          aria-label={`${row.selected ? "Deselect" : "Select"} ${row.label}`}
          aria-pressed={row.selected}
          onclick={() => selectRow(row)}>{row.selected ? "●" : "○"}</button
        >
        {#if row.kind === "body"}
          {#if row.elementCount !== undefined && row.elementCount > 0}
            <button
              type="button"
              class="visibility-body-elements"
              data-testid={`body-elements-${row.testId.replace("body-vis-", "")}`}
              data-body-elements="true"
              data-body-part-occurrence-id={bodyPartOccurrenceId(row)}
              data-body-id={bodyId(row)}
              aria-label={`Inspect ${row.elementCount} elements in ${row.label}`}
              disabled={row.disabled}
              title={`Inspect ${row.elementCount} elements`}
              onclick={() => openElementDetail(row)}>{row.elementCount} elements</button
            >
          {/if}
          <button
            type="button"
            class="visibility-body-name"
            data-body-highlight="true"
            data-body-id={bodyId(row)}
            data-body-part-occurrence-id={bodyPartOccurrenceId(row)}
            data-testid={`body-highlight-${row.testId.replace("body-vis-", "")}`}
            aria-label={`Highlight ${row.label}`}
            aria-pressed={row.highlighted}
            data-active={row.highlighted}
            disabled={row.disabled}
            title={row.label}
            onclick={() => toggleBodyHighlight(row)}>{row.label}</button
          >
        {/if}
      </div>
    {/each}
    <div
      class="visibility-virtual-spacer"
      style={`height: ${rowWindow.bottom}px`}
      aria-hidden="true"
    ></div>
  {/if}
</div>
