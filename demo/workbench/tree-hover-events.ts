import type { VisibilityRowTarget } from "./tree-hover";

/** Installs delegated pointer/focus hover for semantic visibility-tree rows. */
export function installVisibilityTreeHover(
  panel: HTMLElement,
  signal: AbortSignal,
  onHover: (target: VisibilityRowTarget | undefined) => void,
): void {
  panel.addEventListener(
    "pointerover",
    (event) => {
      if (event.pointerType === "touch") return;
      const row = rowFromTarget(event.target);
      if (row === undefined || rowFromTarget(event.relatedTarget) === row) return;
      onHover(targetFromRow(row));
    },
    { signal },
  );
  panel.addEventListener(
    "pointerout",
    (event) => {
      if (event.pointerType === "touch") return;
      const row = rowFromTarget(event.target);
      const next = rowFromTarget(event.relatedTarget);
      if (row === undefined || next === row) return;
      onHover(next === undefined ? undefined : targetFromRow(next));
    },
    { signal },
  );
  panel.addEventListener(
    "focusin",
    (event) => {
      const row = rowFromTarget(event.target);
      if (row !== undefined) onHover(targetFromRow(row));
    },
    { signal },
  );
  panel.addEventListener(
    "focusout",
    (event) => {
      const row = rowFromTarget(event.target);
      const next = rowFromTarget(event.relatedTarget);
      if (row === undefined || next === row) return;
      onHover(next === undefined ? undefined : targetFromRow(next));
    },
    { signal },
  );
}

function rowFromTarget(target: EventTarget | null): HTMLElement | undefined {
  if (!(target instanceof Element)) return undefined;
  return target.closest<HTMLElement>(".visibility-row") ?? undefined;
}

function targetFromRow(row: HTMLElement): VisibilityRowTarget {
  const kind = row.dataset["visibilityTargetKind"];
  if (kind === "assembly") {
    const occurrenceId = row.dataset["visibilityTargetOccurrenceId"];
    if (occurrenceId !== undefined) return { kind, occurrenceId };
  }
  const instanceId = row.dataset["visibilityTargetInstanceId"];
  if (instanceId === undefined) throw new Error("Visibility row is missing an instance id");
  if (kind === "body") {
    const bodyId = row.dataset["visibilityTargetBodyId"];
    if (bodyId !== undefined) return { kind, instanceId, bodyId: Number(bodyId) };
  }
  return { kind: "instance", instanceId };
}
