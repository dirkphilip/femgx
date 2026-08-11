import type { BodyId, InstanceId } from "../../src/index";

/** Creates the compact part-level control for a multi-body placement. */
export function createBodyGroupAction(
  slot: number,
  instanceId: InstanceId,
  bodyIds: readonly BodyId[],
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "visibility-body-group-action";
  button.dataset["bodyGroupAction"] = "visibility";
  button.dataset["bodyInstanceSlot"] = String(slot);
  button.dataset["bodyInstanceId"] = instanceId;
  button.dataset["bodyGroupBodyIds"] = bodyIds.join(",");
  button.dataset["testid"] = `body-group-${slot}`;
  button.setAttribute("aria-label", "Toggle all bodies");
  return button;
}

/** Parses the compact body-id dataset value used by the visibility panel. */
export function parseBodyIds(value: string | undefined): BodyId[] {
  if (value === undefined || value.length === 0) return [];
  return value.split(",").map(Number).filter(Number.isFinite);
}
