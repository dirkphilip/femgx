<script lang="ts">
  import type { WorkbenchController } from "../controller";
  import type { WorkbenchVisibilityRowSnapshot, WorkbenchVisibilitySnapshot } from "../snapshot";

  let {
    controller,
    visibility,
  }: {
    controller: WorkbenchController | undefined;
    visibility: WorkbenchVisibilitySnapshot | undefined;
  } = $props();

  function toggleVisibility(row: WorkbenchVisibilityRowSnapshot): void {
    controller?.commands.toggleVisibility(row.target);
  }

  function toggleBodyHighlight(row: WorkbenchVisibilityRowSnapshot): void {
    if (row.target.kind === "body") controller?.commands.toggleBodyHighlight(row.target);
  }

  function toggleExpanded(row: WorkbenchVisibilityRowSnapshot): void {
    if (row.target.kind === "assembly") {
      controller?.commands.toggleVisibilityTree(row.target.occurrenceId);
    }
  }

  function setTreeHover(row: WorkbenchVisibilityRowSnapshot): void {
    controller?.commands.setTreeHover(row.target);
  }

  function clearTreeHover(): void {
    controller?.commands.setTreeHover(undefined);
  }

  function bodyId(row: WorkbenchVisibilityRowSnapshot): number | undefined {
    return row.target.kind === "body" ? row.target.bodyId : undefined;
  }

  function bodyInstanceId(row: WorkbenchVisibilityRowSnapshot): string | undefined {
    return row.target.kind === "body" ? row.target.instanceId : undefined;
  }

  function rowClass(row: WorkbenchVisibilityRowSnapshot): string {
    return row.kind === "instance" ? "part" : row.kind;
  }
</script>

<div
  id="visibility-panel"
  data-testid="visibility-panel"
  role="tree"
  aria-label="Visibility hierarchy"
>
  {#if visibility !== undefined}
    <div class="visibility-context" data-testid="visibility-context">{visibility.context}</div>
    {#each visibility.rows as row (row.key)}
      <div
        class={`visibility-row visibility-${rowClass(row)}`}
        style={`--visibility-depth: ${row.depth}`}
        hidden={row.hidden}
        role="treeitem"
        data-visibility-target-kind={row.kind}
        data-visibility-target-instance-id={row.target.kind === "assembly"
          ? undefined
          : row.target.instanceId}
        data-visibility-target-occurrence-id={row.target.kind === "assembly"
          ? row.target.occurrenceId
          : undefined}
        data-visibility-target-body-id={row.target.kind === "body" ? row.target.bodyId : undefined}
        aria-level={row.depth}
        aria-posinset={row.position}
        aria-setsize={row.setSize}
        aria-checked={row.checked}
        aria-hidden={row.hidden}
        aria-selected="false"
        tabindex="-1"
        aria-expanded={row.kind === "assembly" ? row.expanded : undefined}
        onpointerenter={() => setTreeHover(row)}
        onpointerleave={clearTreeHover}
        onfocusin={() => setTreeHover(row)}
        onfocusout={clearTreeHover}
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
            data-assembly-occurrence-id={row.target.kind === "assembly"
              ? row.target.occurrenceId
              : undefined}
            data-instance-id={row.target.kind === "instance" ? row.target.instanceId : undefined}
            data-body-id={bodyId(row)}
            data-body-instance-id={bodyInstanceId(row)}
            aria-label={row.ariaLabel}
            onchange={() => toggleVisibility(row)}
          />
          <span class="visibility-kind">{row.badge}</span>
          {#if row.kind !== "body"}
            <span class="visibility-label" title={row.label}>{row.label}</span>
          {/if}
        </label>
        {#if row.kind === "body"}
          <button
            type="button"
            class="visibility-body-name"
            data-body-highlight="true"
            data-body-id={bodyId(row)}
            data-body-instance-id={bodyInstanceId(row)}
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
  {/if}
</div>
