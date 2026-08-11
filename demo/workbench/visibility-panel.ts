import type {
  AssemblyNodeId,
  Body,
  BodyId,
  InstanceId,
  PartId,
  SceneRuntime,
} from "../../src/index";
import { visiblePartIdsForPreset, type ModelPreset } from "../fixture/presets";
import type { ElementDisplayMode } from "../fixture/types";
import { assemblyName } from "../visibility-tree";
import { createBodyGroupAction, parseBodyIds } from "./body-controls";

export type BodyAction = "highlight" | "color";

/** Callbacks that keep the runtime as the single source of visibility truth. */
export interface VisibilityPanelOptions {
  readonly panel: HTMLElement;
  readonly getPreset: () => ModelPreset;
  readonly getRuntime: () => SceneRuntime;
  readonly getMode: () => ElementDisplayMode;
  readonly partName: (partId: PartId) => string | undefined;
  readonly partVisible: (partId: PartId) => boolean;
  readonly bodyVisible: (instanceId: InstanceId, bodyId: BodyId) => boolean;
  readonly bodyGroupVisible: (instanceId: InstanceId, bodyIds: readonly BodyId[]) => boolean;
  readonly bodyHighlighted: (instanceId: InstanceId, bodyId: BodyId) => boolean;
  readonly bodyColorActive: (instanceId: InstanceId, bodyId: BodyId) => boolean;
  readonly onPartVisibility: (partId: PartId, visible: boolean) => void;
  readonly onBodyVisibility: (instanceId: InstanceId, bodyId: BodyId, visible: boolean) => void;
  readonly onBodyGroupVisibility: (
    instanceId: InstanceId,
    bodyIds: readonly BodyId[],
    visible: boolean,
  ) => void;
  readonly onBodyAction: (instanceId: InstanceId, bodyId: BodyId, action: BodyAction) => void;
  readonly onInstanceVisibility: (instanceId: InstanceId, visible: boolean) => void;
  readonly onAssemblyVisibility: (nodeId: AssemblyNodeId, visible: boolean) => void;
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
    const rootNodeId = this.options.getRuntime().getNodeIds()[0];
    if (rootNodeId !== undefined) {
      panel.appendChild(
        this.assemblyNode(rootNodeId, visiblePartIdsForPreset(preset, this.options.getMode())),
      );
    }
    this.sync();
  }

  sync(): void {
    const runtime = this.options.getRuntime();
    for (const input of this.options.panel.querySelectorAll<HTMLInputElement>("input")) {
      const bodyId = input.dataset["bodyId"];
      if (bodyId !== undefined) {
        const instanceId = input.dataset["bodyInstanceId"];
        input.checked =
          instanceId !== undefined && this.options.bodyVisible(instanceId, Number(bodyId));
        input.indeterminate = false;
        input.disabled = !this.instanceVisible(runtime, instanceId);
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
        const node = runtime.getNode(assemblyNodeId);
        input.checked = node?.effectiveVisible ?? false;
        input.indeterminate = false;
        const parent = node?.parentId === undefined ? undefined : runtime.getNode(node.parentId);
        input.disabled = parent !== undefined && !parent.effectiveVisible;
        continue;
      }
      const instanceId = input.dataset["instanceId"];
      if (instanceId !== undefined) {
        const instance = runtime.getInstance(instanceId);
        input.checked = instance?.visible ?? false;
        input.indeterminate = false;
        const node = instance === undefined ? undefined : runtime.getNode(instance.nodeId);
        input.disabled =
          node === undefined || !node.effectiveVisible || instance?.partVisible !== true;
      }
    }
    for (const button of this.options.panel.querySelectorAll<HTMLButtonElement>(
      "button[data-body-action]",
    )) {
      const instanceId = button.dataset["bodyInstanceId"];
      const bodyId = button.dataset["bodyId"];
      const action = button.dataset["bodyAction"] as BodyAction | undefined;
      if (instanceId === undefined || bodyId === undefined || action === undefined) continue;
      button.disabled = !this.instanceVisible(runtime, instanceId);
      button.dataset["active"] = String(
        action === "highlight"
          ? this.options.bodyHighlighted(instanceId, Number(bodyId))
          : this.options.bodyColorActive(instanceId, Number(bodyId)),
      );
    }
    for (const button of this.options.panel.querySelectorAll<HTMLButtonElement>(
      "button[data-body-group-action]",
    )) {
      const instanceId = button.dataset["bodyInstanceId"];
      const bodyIds = parseBodyIds(button.dataset["bodyGroupBodyIds"]);
      if (instanceId === undefined || bodyIds.length === 0) continue;
      const visible = this.options.bodyGroupVisible(instanceId, bodyIds);
      button.disabled = !this.instanceVisible(runtime, instanceId);
      button.textContent = visible ? "Hide bodies" : "Show bodies";
      button.dataset["active"] = String(!visible);
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
      this.options.onAssemblyVisibility(assemblyNodeId, target.checked);
    } else {
      const instanceId = target.dataset["instanceId"];
      if (instanceId !== undefined) this.options.onInstanceVisibility(instanceId, target.checked);
    }
  }

  private onClick(event: Event): void {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest<HTMLButtonElement>("button[data-body-action]");
    if (button !== null) {
      const instanceId = button.dataset["bodyInstanceId"];
      const bodyId = button.dataset["bodyId"];
      const action = button.dataset["bodyAction"] as BodyAction | undefined;
      if (instanceId !== undefined && bodyId !== undefined && action !== undefined) {
        this.options.onBodyAction(instanceId, Number(bodyId), action);
      }
      return;
    }
    const group = target.closest<HTMLButtonElement>("button[data-body-group-action]");
    if (group === null) return;
    const instanceId = group.dataset["bodyInstanceId"];
    const bodyIds = parseBodyIds(group.dataset["bodyGroupBodyIds"]);
    if (instanceId === undefined || bodyIds.length === 0) return;
    this.options.onBodyGroupVisibility(
      instanceId,
      bodyIds,
      !this.options.bodyGroupVisible(instanceId, bodyIds),
    );
  }

  private assemblyNode(nodeId: AssemblyNodeId, visibleParts: ReadonlySet<PartId>): HTMLElement {
    const preset = this.options.getPreset();
    const runtime = this.options.getRuntime();
    const node = runtime.getNode(nodeId);
    if (node === undefined) throw new Error(`Missing runtime node ${nodeId}`);
    const assemblyId = node.assemblyId;
    const name = assemblyName(preset.scene.assemblies.get(assemblyId)) ?? `Assembly ${assemblyId}`;
    const displayName = this.assemblyOccurrenceName(nodeId, name);
    const branch = document.createElement("div");
    branch.className = "visibility-branch";
    const row = document.createElement("div");
    row.className = "visibility-row visibility-assembly";
    const expander = document.createElement("button");
    expander.type = "button";
    expander.className = "visibility-expander";
    expander.dataset["testid"] = `assembly-expand-${this.nodeDisplayId(nodeId)}`;
    expander.setAttribute("aria-expanded", "true");
    expander.setAttribute("aria-label", `Collapse ${displayName}`);
    expander.textContent = "▾";
    const children = document.createElement("div");
    children.className = "visibility-children";
    const directInstances = this.directPartInstances(nodeId, visibleParts);
    for (let index = 0; index < directInstances.length; index++) {
      const instanceId = directInstances[index];
      if (instanceId !== undefined)
        children.appendChild(this.partNode(instanceId, index + 1, directInstances));
    }
    for (const childId of node.childIds) {
      children.appendChild(this.assemblyNode(childId, visibleParts));
    }
    expander.addEventListener("click", () => {
      this.toggleExpanded(expander, children, displayName);
    });
    row.append(
      expander,
      this.rowLabel("assembly-node", nodeId, displayName, undefined, this.nodeDisplayId(nodeId)),
    );
    branch.append(row, children);
    return branch;
  }

  private partNode(
    instanceId: InstanceId,
    index: number,
    siblings: readonly InstanceId[],
  ): HTMLElement {
    const runtime = this.options.getRuntime();
    const instance = runtime.getInstance(instanceId);
    const partId = instance?.partId;
    const name = this.options.partName(partId ?? -1) ?? `Part ${partId}`;
    const repeated = siblings.filter((item) => runtime.getPartId(item) === partId).length > 1;
    const row = document.createElement("div");
    row.className = "visibility-row visibility-part";
    const spacer = document.createElement("span");
    spacer.className = "visibility-spacer";
    spacer.setAttribute("aria-hidden", "true");
    const part =
      partId === undefined ? undefined : this.options.getPreset().scene.parts.get(partId);
    const bodies = part?.geometry.bodies ?? [];
    row.append(
      spacer,
      this.rowLabel(
        "instance",
        instanceId,
        repeated ? `${name} ${index}` : name,
        "Part",
        this.instanceDisplayId(instanceId),
      ),
    );
    if (bodies.length > 1) {
      row.append(
        createBodyGroupAction(
          this.instanceDisplayId(instanceId),
          instanceId,
          bodies.map((body) => body.id),
        ),
      );
    }
    const branch = document.createElement("div");
    branch.className = "visibility-body-branch";
    branch.appendChild(row);
    for (const body of bodies) {
      branch.appendChild(this.bodyNode(instanceId, body));
    }
    return branch;
  }

  private bodyNode(instanceId: InstanceId, body: Body): HTMLElement {
    const displayId = this.instanceDisplayId(instanceId);
    const row = document.createElement("div");
    row.className = "visibility-row visibility-body";
    const spacer = document.createElement("span");
    spacer.className = "visibility-spacer visibility-body-spacer";
    spacer.setAttribute("aria-hidden", "true");
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.dataset["bodyId"] = String(body.id);
    input.dataset["bodyInstanceId"] = instanceId;
    input.dataset["testid"] = `body-vis-${displayId}-${body.id}`;
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
      button.dataset["bodyId"] = String(body.id);
      button.dataset["bodyInstanceId"] = instanceId;
      button.dataset["testid"] = `body-${action}-${displayId}-${body.id}`;
      button.setAttribute("aria-label", `${action} ${text.textContent}`);
      button.textContent = action === "highlight" ? "Glow" : "Color";
      actions.appendChild(button);
    }
    row.append(spacer, label, actions);
    return row;
  }

  private directPartInstances(
    nodeId: AssemblyNodeId,
    visibleParts: ReadonlySet<PartId>,
  ): InstanceId[] {
    const runtime = this.options.getRuntime();
    return (
      runtime.getNode(nodeId)?.instanceIds.filter((instanceId) => {
        if (runtime.getInstance(instanceId)?.nodeId !== nodeId) return false;
        const partId = runtime.getPartId(instanceId);
        return partId !== undefined && visibleParts.has(partId);
      }) ?? []
    );
  }

  private assemblyOccurrenceName(nodeId: AssemblyNodeId, name: string): string {
    const runtime = this.options.getRuntime();
    const node = runtime.getNode(nodeId);
    const parent = node?.parentId === undefined ? undefined : runtime.getNode(node.parentId);
    if (parent === undefined || node === undefined) return name;
    let occurrence = 0;
    let total = 0;
    for (const siblingId of parent.childIds) {
      const sibling = runtime.getNode(siblingId);
      if (sibling?.assemblyId === node.assemblyId) {
        total += 1;
        if (siblingId === nodeId) occurrence = total;
      }
    }
    return total > 1 ? `${name} ${occurrence}` : name;
  }

  private rowLabel(
    kind: "part" | "assembly-node" | "instance",
    id: string | number,
    name: string,
    badgeText?: "Part",
    testId = id,
  ): HTMLLabelElement {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    if (kind === "part") {
      input.dataset["partId"] = String(id);
      input.dataset["testid"] = `part-vis-${id}`;
    } else if (kind === "assembly-node") {
      input.dataset["assemblyNodeId"] = String(id);
      input.dataset["testid"] = `assembly-node-vis-${testId}`;
    } else {
      input.dataset["instanceId"] = String(id);
      input.dataset["testid"] = `instance-vis-${testId}`;
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

  private instanceVisible(runtime: SceneRuntime, instanceId: InstanceId | undefined): boolean {
    return instanceId !== undefined && runtime.isInstanceVisible(instanceId);
  }

  private nodeDisplayId(nodeId: AssemblyNodeId): number {
    return this.options.getRuntime().getNodeIds().indexOf(nodeId);
  }

  private instanceDisplayId(instanceId: InstanceId): number {
    return this.options.getRuntime().getInstanceIds().indexOf(instanceId);
  }

  private toggleExpanded(expander: HTMLButtonElement, children: HTMLElement, name: string): void {
    const expanded = children.hidden;
    children.hidden = !expanded;
    expander.setAttribute("aria-expanded", String(expanded));
    expander.setAttribute("aria-label", `${expanded ? "Collapse" : "Expand"} ${name}`);
    expander.textContent = expanded ? "▾" : "▸";
  }
}
