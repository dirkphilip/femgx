<script lang="ts">
  import { onMount } from "svelte";
  import type { ElementId } from "@/entries/model";
  import type {
    WorkbenchElementDetailSnapshot,
    WorkbenchPresentationPort,
  } from "../presentation/snapshot";

  let {
    workbench,
    detail,
  }: {
    workbench: WorkbenchPresentationPort | undefined;
    detail: WorkbenchElementDetailSnapshot | undefined;
  } = $props();

  const ROW_HEIGHT = 44;
  const OVERSCAN = 8;
  let panelElement: { clientHeight: number; scrollTop: number } | undefined = $state();
  let scrollTop = $state(0);
  let viewportHeight = $state(300);

  const elementIds = $derived.by(() =>
    workbench === undefined || detail === undefined
      ? []
      : workbench.elementDetails.elementIdsForDetail(detail),
  );
  const rowWindow = $derived.by(() => {
    const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
    const end = Math.min(
      elementIds.length,
      Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN,
    );
    return {
      elements: elementIds.slice(start, end),
      top: start * ROW_HEIGHT,
      bottom: Math.max(0, elementIds.length - end) * ROW_HEIGHT,
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

  function select(elementId: ElementId): void {
    if (detail !== undefined) workbench?.commands.selectElementDetail(detail, elementId);
  }

  function setHover(elementId: ElementId): void {
    if (detail !== undefined) workbench?.commands.setElementDetailHover(detail, elementId);
  }

  function clearHover(elementId: ElementId): void {
    if (detail !== undefined) workbench?.commands.clearElementDetailHover(detail, elementId);
  }

  function close(): void {
    const currentDetail = detail;
    workbench?.commands.closeElementDetail();
    if (currentDetail === undefined) return;
    globalThis.setTimeout(() => {
      const trigger = Array.from(
        globalThis.document.querySelectorAll<HTMLElement>("[data-body-elements]"),
      ).find(
        (candidate) =>
          candidate.getAttribute("data-body-part-occurrence-id") ===
            currentDetail.partOccurrenceId &&
          candidate.getAttribute("data-body-id") === String(currentDetail.bodyId),
      );
      trigger?.focus();
    }, 0);
  }
</script>

{#if workbench !== undefined && detail !== undefined}
  <div
    id="element-detail"
    data-testid="element-detail"
    role="dialog"
    aria-label={`Elements in ${detail.label}`}
  >
    <header class="element-detail-header">
      <button
        type="button"
        class="element-detail-back"
        data-testid="element-detail-back"
        aria-label="Back to visibility hierarchy"
        onclick={close}>Back</button
      >
      <div>
        <h3>{detail.label}</h3>
        <p>{detail.count} authored elements · {detail.partName}</p>
      </div>
    </header>
    <div
      id="element-detail-list"
      data-testid="element-detail-list"
      role="listbox"
      aria-label={`Elements in ${detail.label}`}
      bind:this={panelElement}
      onscroll={updateScroll}
    >
      <div
        class="element-detail-spacer"
        style={`height: ${rowWindow.top}px`}
        aria-hidden="true"
      ></div>
      {#each rowWindow.elements as elementId (elementId)}
        <button
          type="button"
          class="element-detail-row"
          role="option"
          aria-selected={workbench.elementDetails.isElementSelected(
            detail.partOccurrenceId,
            elementId,
          )}
          data-testid={`element-detail-${detail.partOccurrenceId.replaceAll("/", "-")}-${elementId}`}
          data-element-part-occurrence-id={detail.partOccurrenceId}
          data-element-id={elementId}
          onpointerenter={() => setHover(elementId)}
          onpointerleave={() => clearHover(elementId)}
          onclick={() => select(elementId)}
        >
          <span class="visibility-kind">Element</span>
          <span>Element {elementId}</span>
        </button>
      {/each}
      <div
        class="element-detail-spacer"
        style={`height: ${rowWindow.bottom}px`}
        aria-hidden="true"
      ></div>
    </div>
  </div>
{/if}
