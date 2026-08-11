import type {
  Body,
  BodyId,
  ElementRenderMode,
  InstanceId,
  PartId,
  SceneRuntime,
} from "../../src/index";
import { visiblePartIdsForPreset, type ModelPreset } from "../fixture/presets";
import { assemblyName } from "../visibility-tree";

export type BodyAction = "highlight" | "color";

/** Callbacks that keep the runtime as the single source of visibility truth. */
export interface VisibilityPanelOptions {
  readonly panel: HTMLElement;
  readonly getPreset: () => ModelPreset;
  readonly getRuntime: () => SceneRuntime;
  readonly getMode: () => ElementRenderMode;
  readonly partName: (partId: PartId) => string | undefined;
  readonly partVisible: (partId: PartId) => boolean;
  readonly bodyVisible: (instanceId: InstanceId, bodyId: BodyId) => boolean;
  readonly bodyHighlighted: (instanceId: InstanceId, bodyId: BodyId) => boolean;
  readonly bodyColorActive: (instanceId: InstanceId, bodyId: BodyId) => boolean;
  readonly onPartVisibility: (partId: PartId, visible: boolean) => void;
  readonly onBodyVisibility: (instanceId: InstanceId, bodyId: BodyId, visible: boolean) => void;
  readonly onBodyAction: (instanceId: InstanceId, bodyId: BodyId, action: BodyAction) => void;
  readonly onInstanceVisibility: (slot: number, visible: boolean) => void;
  readonly onAssemblyVisibility: (nodeId: number, visible: boolean) => void;
}

/** Builds and synchronizes the expanded assembly/part visibility tree. */
export class VisibilityPanelController {
  private readonly options: VisibilityPanelOptions;

  constructor(options: VisibilityPanelOptions) {
    this.options = options;
  }

  install(signal: AbortSignal): void {
    this.options.panel.addEventListener(
      "change",
      (event) => {
        this.onChange(event);
      },
      { signal },
    );
    this.options.panel.addEventListener(
      "click",
      (event) => {
        this.onClick(event);
      },
      { signal },
    );
  }

  rebuild(): void {
    const { panel } = this.options;
    const preset = this.options.getPreset();
    panel.textContent = "";
    const rootAssemblyId = preset.scene.rootAssemblyId;
    const context = document.createElement("div");
    context.className = "visibility-context";
    context.dataset["testid"] = "visibility-context";
    context.textContent = `Assembly · ${assemblyName(preset.scene.assemblies.get(rootAssemblyId)) ?? `Assembly ${rootAssemblyId}`}`;
    panel.appendChild(context);
    panel.appendChild(
      this.assemblyNode(0, visiblePartIdsForPreset(preset, this.options.getMode())),
    );
    this.sync();
  }

  sync(): void {
    const runtime = this.options.getRuntime();
    for (const input of this.options.panel.querySelectorAll<HTMLInputElement>("input")) {
      const bodyId = input.dataset["bodyId"];
      if (bodyId !== undefined) {
        const instanceId = input.dataset["bodyInstanceId"];
        const slot = Number(input.dataset["bodyInstanceSlot"] ?? "-1");
        input.checked =
          instanceId !== undefined && this.options.bodyVisible(instanceId, Number(bodyId));
        input.indeterminate = false;
        input.disabled = !this.instanceVisible(runtime, slot);
        continue;
      }
      const partId = input.dataset["partId"];
      if (partId !== undefined) {
        input.checked = this.options.partVisible(Number(partId));
        input.indeterminate = false;
        input.disabled = false;
        continue;
      }
      const assemblyNodeId = input.dataset["assemblyNodeId"];
      if (assemblyNodeId !== undefined) {
        const nodeId = Number(assemblyNodeId);
        input.checked = runtime.nodeEffectiveVisible[nodeId] === 1;
        input.indeterminate = false;
        const parent = runtime.nodeParents[nodeId] ?? -1;
        input.disabled = parent !== -1 && runtime.nodeEffectiveVisible[parent] !== 1;
        continue;
      }
      const instanceSlot = input.dataset["instanceSlot"];
      if (instanceSlot !== undefined) {
        const slot = Number(instanceSlot);
        input.checked = runtime.isInstanceVisible(slot);
        input.indeterminate = false;
        const owningNode = runtime.instanceOwningNode[slot];
        input.disabled =
          owningNode === undefined ||
          runtime.nodeEffectiveVisible[owningNode] !== 1 ||
          runtime.instancePartVisible[slot] !== 1;
      }
    }
    for (const button of this.options.panel.querySelectorAll<HTMLButtonElement>(
      "button[data-body-action]",
    )) {
      const instanceId = button.dataset["bodyInstanceId"];
      const bodyId = button.dataset["bodyId"];
      const action = button.dataset["bodyAction"] as BodyAction | undefined;
      const slot = Number(button.dataset["bodyInstanceSlot"] ?? "-1");
      if (instanceId === undefined || bodyId === undefined || action === undefined) continue;
      button.disabled = !this.instanceVisible(runtime, slot);
      button.dataset["active"] = String(
        action === "highlight"
          ? this.options.bodyHighlighted(instanceId, Number(bodyId))
          : this.options.bodyColorActive(instanceId, Number(bodyId)),
      );
    }
  }

  private onChange(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    const bodyId = target.dataset["bodyId"];
    if (bodyId !== undefined) {
      const instanceId = target.dataset["bodyInstanceId"];
      if (instanceId !== undefined) {
        this.options.onBodyVisibility(instanceId, Number(bodyId), target.checked);
      }
      return;
    }
    const partId = target.dataset["partId"];
    const assemblyNodeId = target.dataset["assemblyNodeId"];
    if (partId !== undefined) this.options.onPartVisibility(Number(partId), target.checked);
    else if (assemblyNodeId !== undefined) {
      this.options.onAssemblyVisibility(Number(assemblyNodeId), target.checked);
    } else {
      const instanceSlot = target.dataset["instanceSlot"];
      if (instanceSlot !== undefined)
        this.options.onInstanceVisibility(Number(instanceSlot), target.checked);
    }
  }

  private onClick(event: Event): void {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest<HTMLButtonElement>("button[data-body-action]");
    if (button === null) return;
    const instanceId = button.dataset["bodyInstanceId"];
    const bodyId = button.dataset["bodyId"];
    const action = button.dataset["bodyAction"] as BodyAction | undefined;
    if (instanceId === undefined || bodyId === undefined || action === undefined) return;
    this.options.onBodyAction(instanceId, Number(bodyId), action);
  }

  private assemblyNode(nodeId: number, visibleParts: ReadonlySet<PartId>): HTMLElement {
    const preset = this.options.getPreset();
    const runtime = this.options.getRuntime();
    const assemblyId = runtime.nodeAssemblyIds[nodeId];
    if (assemblyId === undefined) throw new Error(`Missing assembly id for runtime node ${nodeId}`);
    const name = assemblyName(preset.scene.assemblies.get(assemblyId)) ?? `Assembly ${assemblyId}`;
    const displayName = this.assemblyOccurrenceName(nodeId, name);
    const branch = document.createElement("div");
    branch.className = "visibility-branch";
    const row = document.createElement("div");
    row.className = "visibility-row visibility-assembly";
    const expander = document.createElement("button");
    expander.type = "button";
    expander.className = "visibility-expander";
    expander.dataset["testid"] = `assembly-expand-${nodeId}`;
    expander.setAttribute("aria-expanded", "true");
    expander.setAttribute("aria-label", `Collapse ${displayName}`);
    expander.textContent = "▾";
    const children = document.createElement("div");
    children.className = "visibility-children";
    const directSlots = this.directPartSlots(nodeId, visibleParts);
    for (let index = 0; index < directSlots.length; index++) {
      const slot = directSlots[index];
      if (slot !== undefined) children.appendChild(this.partNode(slot, index + 1, directSlots));
    }
    let child = runtime.nodeFirstChild[nodeId] ?? -1;
    while (child !== -1) {
      children.appendChild(this.assemblyNode(child, visibleParts));
      child = runtime.nodeNextSibling[child] ?? -1;
    }
    expander.addEventListener("click", () => {
      this.toggleExpanded(expander, children, displayName);
    });
    row.append(expander, this.rowLabel("assembly-node", nodeId, displayName));
    branch.append(row, children);
    return branch;
  }

  private partNode(slot: number, index: number, siblings: readonly number[]): HTMLElement {
    const runtime = this.options.getRuntime();
    const partId = runtime.instancePartIds[slot];
    const name = this.options.partName(partId ?? -1) ?? `Part ${partId}`;
    const repeated = siblings.filter((item) => runtime.instancePartIds[item] === partId).length > 1;
    const row = document.createElement("div");
    row.className = "visibility-row visibility-part";
    const spacer = document.createElement("span");
    spacer.className = "visibility-spacer";
    spacer.setAttribute("aria-hidden", "true");
    row.append(
      spacer,
      this.rowLabel("instance", slot, repeated ? `${name} ${index}` : name, "Part"),
    );
    const branch = document.createElement("div");
    branch.className = "visibility-body-branch";
    branch.appendChild(row);
    const part =
      partId === undefined ? undefined : this.options.getPreset().scene.parts.get(partId);
    for (const body of part?.geometry.bodies ?? []) {
      branch.appendChild(this.bodyNode(slot, body));
    }
    return branch;
  }

  private bodyNode(slot: number, body: Body): HTMLElement {
    const runtime = this.options.getRuntime();
    const instanceId = runtime.getInstanceId(slot);
    const row = document.createElement("div");
    row.className = "visibility-row visibility-body";
    const spacer = document.createElement("span");
    spacer.className = "visibility-spacer visibility-body-spacer";
    spacer.setAttribute("aria-hidden", "true");
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.dataset["bodyId"] = String(body.id);
    input.dataset["bodyInstanceSlot"] = String(slot);
    if (instanceId !== undefined) input.dataset["bodyInstanceId"] = instanceId;
    input.dataset["testid"] = `body-vis-${slot}-${body.id}`;
    label.append(input);
    const badge = document.createElement("span");
    badge.className = "visibility-kind";
    badge.textContent = "Body";
    label.append(badge);
    const text = document.createElement("span");
    text.className = "visibility-label";
    text.textContent = body.name ?? `Body ${body.id}`;
    label.append(text);
    const actions = document.createElement("span");
    actions.className = "visibility-body-actions";
    for (const action of ["highlight", "color"] as const) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "visibility-body-action";
      button.dataset["bodyAction"] = action;
      button.dataset["bodyInstanceSlot"] = String(slot);
      button.dataset["bodyId"] = String(body.id);
      if (instanceId !== undefined) button.dataset["bodyInstanceId"] = instanceId;
      button.dataset["testid"] = `body-${action}-${slot}-${body.id}`;
      button.setAttribute("aria-label", `${action} ${text.textContent}`);
      button.textContent = action === "highlight" ? "Glow" : "Color";
      actions.appendChild(button);
    }
    row.append(spacer, label, actions);
    return row;
  }

  private directPartSlots(nodeId: number, visibleParts: ReadonlySet<PartId>): number[] {
    const runtime = this.options.getRuntime();
    const slots: number[] = [];
    for (let slot = 0; slot < runtime.instanceCount; slot++) {
      const partId = runtime.instancePartIds[slot];
      if (
        runtime.instanceOwningNode[slot] === nodeId &&
        partId !== undefined &&
        visibleParts.has(partId)
      )
        slots.push(slot);
    }
    return slots;
  }

  private assemblyOccurrenceName(nodeId: number, name: string): string {
    const runtime = this.options.getRuntime();
    const parent = runtime.nodeParents[nodeId] ?? -1;
    if (parent === -1) return name;
    const assemblyId = runtime.nodeAssemblyIds[nodeId];
    let occurrence = 0;
    let total = 0;
    let sibling = runtime.nodeFirstChild[parent] ?? -1;
    while (sibling !== -1) {
      if (runtime.nodeAssemblyIds[sibling] === assemblyId) {
        total += 1;
        if (sibling === nodeId) occurrence = total;
      }
      sibling = runtime.nodeNextSibling[sibling] ?? -1;
    }
    return total > 1 ? `${name} ${occurrence}` : name;
  }

  private rowLabel(
    kind: "part" | "assembly-node" | "instance",
    id: number,
    name: string,
    badgeText?: "Part",
  ): HTMLLabelElement {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    if (kind === "part") {
      input.dataset["partId"] = String(id);
      input.dataset["testid"] = `part-vis-${id}`;
    } else if (kind === "assembly-node") {
      input.dataset["assemblyNodeId"] = String(id);
      input.dataset["testid"] = `assembly-node-vis-${id}`;
    } else {
      input.dataset["instanceSlot"] = String(id);
      const instanceId = this.options.getRuntime().getInstanceId(id);
      if (instanceId !== undefined) input.dataset["instanceId"] = instanceId;
      input.dataset["testid"] = `instance-vis-${id}`;
    }
    label.append(input);
    const badge = document.createElement("span");
    badge.className = "visibility-kind";
    badge.textContent =
      badgeText ?? (kind === "part" ? "Part" : kind === "assembly-node" ? "Assembly" : "Instance");
    label.append(badge);
    const text = document.createElement("span");
    text.className = "visibility-label";
    text.textContent = name;
    label.append(text);
    return label;
  }

  private instanceVisible(runtime: SceneRuntime, slot: number): boolean {
    const owningNode = runtime.instanceOwningNode[slot];
    return (
      owningNode !== undefined &&
      runtime.nodeEffectiveVisible[owningNode] === 1 &&
      runtime.instancePartVisible[slot] === 1 &&
      runtime.isInstanceVisible(slot)
    );
  }

  private toggleExpanded(expander: HTMLButtonElement, children: HTMLElement, name: string): void {
    const expanded = children.hidden;
    children.hidden = !expanded;
    expander.setAttribute("aria-expanded", String(expanded));
    expander.setAttribute("aria-label", `${expanded ? "Collapse" : "Expand"} ${name}`);
    expander.textContent = expanded ? "▾" : "▸";
  }
}
