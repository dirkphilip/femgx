import type {
  AssemblyNodeId,
  Body,
  BodyId,
  InstanceId,
  PartId,
  SceneRuntime,
} from "../../src/index";
import type { WorkbenchModel } from "./model";
import { assemblyName } from "./visibility-tree";
import type { VisibilityRowTarget } from "./tree-hover";
import { installVisibilityTreeHover } from "./tree-hover-events";
import { visibilityRowLabel } from "./visibility-row";

/** Callbacks that keep the runtime as the single source of visibility truth. */
export interface VisibilityPanelOptions {
  readonly panel: HTMLElement;
  readonly getModel: () => WorkbenchModel;
  readonly getRuntime: () => SceneRuntime;
  readonly partName: (partId: PartId) => string | undefined;
  readonly partVisible: (partId: PartId) => boolean;
  readonly bodyVisible: (instanceId: InstanceId, bodyId: BodyId) => boolean;
  readonly bodyHighlighted: (instanceId: InstanceId, bodyId: BodyId) => boolean;
  readonly onPartVisibility: (partId: PartId, visible: boolean) => void;
  readonly onBodyVisibility: (instanceId: InstanceId, bodyId: BodyId, visible: boolean) => void;
  readonly onBodyHighlight: (instanceId: InstanceId, bodyId: BodyId) => void;
  readonly onInstanceVisibility: (instanceId: InstanceId, visible: boolean) => void;
  readonly onAssemblyVisibility: (nodeId: AssemblyNodeId, visible: boolean) => void;
  readonly onTreeHover?: (target: VisibilityRowTarget | undefined) => void;
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
    if (this.options.onTreeHover !== undefined) {
      installVisibilityTreeHover(this.options.panel, signal, this.options.onTreeHover);
    }
  }

  rebuild(): void {
    const { panel } = this.options;
    this.options.onTreeHover?.(undefined);
    const model = this.options.getModel();
    panel.textContent = "";
    const rootAssemblyId = model.scene.rootAssemblyId;
    const context = document.createElement("div");
    context.className = "visibility-context";
    context.dataset["testid"] = "visibility-context";
    context.textContent = `Assembly · ${assemblyName(model.scene.assemblies.get(rootAssemblyId)) ?? `Assembly ${rootAssemblyId}`}`;
    panel.appendChild(context);
    const rootNodeId = this.options.getRuntime().getNodeIds()[0];
    if (rootNodeId !== undefined) {
      panel.appendChild(this.assemblyNode(rootNodeId));
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
      "button[data-body-highlight]",
    )) {
      const instanceId = button.dataset["bodyInstanceId"];
      const bodyId = button.dataset["bodyId"];
      if (instanceId === undefined || bodyId === undefined) continue;
      button.disabled = !this.instanceVisible(runtime, instanceId);
      button.dataset["active"] = String(this.options.bodyHighlighted(instanceId, Number(bodyId)));
      button.setAttribute(
        "aria-pressed",
        String(this.options.bodyHighlighted(instanceId, Number(bodyId))),
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
      this.options.onAssemblyVisibility(assemblyNodeId, target.checked);
    } else {
      const instanceId = target.dataset["instanceId"];
      if (instanceId !== undefined) this.options.onInstanceVisibility(instanceId, target.checked);
    }
  }

  private onClick(event: Event): void {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest<HTMLButtonElement>("button[data-body-highlight]");
    if (button !== null) {
      const instanceId = button.dataset["bodyInstanceId"];
      const bodyId = button.dataset["bodyId"];
      if (instanceId !== undefined && bodyId !== undefined) {
        this.options.onBodyHighlight(instanceId, Number(bodyId));
      }
      return;
    }
  }

  private assemblyNode(nodeId: AssemblyNodeId): HTMLElement {
    const model = this.options.getModel();
    const runtime = this.options.getRuntime();
    const node = runtime.getNode(nodeId);
    if (node === undefined) throw new Error(`Missing runtime node ${nodeId}`);
    const assemblyId = node.assemblyId;
    const name = assemblyName(model.scene.assemblies.get(assemblyId)) ?? `Assembly ${assemblyId}`;
    const displayName = this.assemblyOccurrenceName(nodeId, name);
    const branch = document.createElement("div");
    branch.className = "visibility-branch";
    const row = document.createElement("div");
    row.className = "visibility-row visibility-assembly";
    row.dataset["visibilityTargetKind"] = "assembly";
    row.dataset["visibilityTargetNodeId"] = nodeId;
    const expander = document.createElement("button");
    expander.type = "button";
    expander.className = "visibility-expander";
    expander.dataset["testid"] = `assembly-expand-${this.nodeDisplayId(nodeId)}`;
    const expanded = node.parentId === undefined || node.parentId === runtime.getNodeIds()[0];
    expander.setAttribute("aria-expanded", String(expanded));
    expander.setAttribute("aria-label", `${expanded ? "Collapse" : "Expand"} ${displayName}`);
    expander.textContent = "▾";
    const children = document.createElement("div");
    children.className = "visibility-children";
    children.hidden = !expanded;
    const directInstances = this.directPartInstances(nodeId);
    for (let index = 0; index < directInstances.length; index++) {
      const instanceId = directInstances[index];
      if (instanceId !== undefined)
        children.appendChild(this.partNode(instanceId, index + 1, directInstances));
    }
    for (const childId of node.childIds) {
      children.appendChild(this.assemblyNode(childId));
    }
    expander.textContent = expanded ? "▾" : "▸";
    expander.addEventListener("click", () => {
      this.toggleExpanded(expander, children, displayName);
    });
    row.append(
      expander,
      visibilityRowLabel(
        "assembly-node",
        nodeId,
        displayName,
        undefined,
        this.nodeDisplayId(nodeId),
      ),
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
    row.dataset["visibilityTargetKind"] = "instance";
    row.dataset["visibilityTargetInstanceId"] = instanceId;
    const spacer = document.createElement("span");
    spacer.className = "visibility-spacer";
    spacer.setAttribute("aria-hidden", "true");
    const part = partId === undefined ? undefined : this.options.getModel().scene.parts.get(partId);
    const bodies = part?.geometry.bodies ?? [];
    row.append(
      spacer,
      visibilityRowLabel(
        "instance",
        instanceId,
        repeated ? `${name} ${index}` : name,
        "Part",
        this.instanceDisplayId(instanceId),
      ),
    );
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
    row.dataset["visibilityTargetKind"] = "body";
    row.dataset["visibilityTargetInstanceId"] = instanceId;
    row.dataset["visibilityTargetBodyId"] = String(body.id);
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
    const bodyName = body.name ?? `Body ${body.id}`;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "visibility-body-name";
    button.dataset["bodyHighlight"] = "true";
    button.dataset["bodyId"] = String(body.id);
    button.dataset["bodyInstanceId"] = instanceId;
    button.dataset["testid"] = `body-highlight-${displayId}-${body.id}`;
    button.setAttribute("aria-label", `Highlight ${bodyName}`);
    button.setAttribute("aria-pressed", "false");
    button.textContent = bodyName;
    button.title = bodyName;
    row.append(spacer, label, button);
    return row;
  }

  private directPartInstances(nodeId: AssemblyNodeId): InstanceId[] {
    const runtime = this.options.getRuntime();
    return (
      runtime.getNode(nodeId)?.instanceIds.filter((instanceId) => {
        return runtime.getInstance(instanceId)?.nodeId === nodeId;
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
    if (!expanded) this.options.onTreeHover?.(undefined);
    children.hidden = !expanded;
    expander.setAttribute("aria-expanded", String(expanded));
    expander.setAttribute("aria-label", `${expanded ? "Collapse" : "Expand"} ${name}`);
    expander.textContent = expanded ? "▾" : "▸";
  }
}
