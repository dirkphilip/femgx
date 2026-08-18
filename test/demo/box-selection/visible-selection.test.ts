import { describe, expect, it, vi } from "vitest";
import {
  hoveredTarget,
  isTargetHighlighted,
  isTargetSelected,
  setTargetHighlighted,
  setTargetSelected,
  setTargetHovered,
  selectedKeys,
  rect,
  harness,
  element,
  nodeHit,
  faceHit,
  edgeHit,
  complete,
  createInteractionState,
} from "./support";

describe("workbench visible-selection", () => {
  it.each([
    ["part", { kind: "part", partId: 1 }, "p:1"],
    ["instance", { kind: "instance", instanceId: "instance-a" }, "i:instance-a"],
  ] as const)(
    "supports %s visible-surface box selection",
    async (granularity, target, expected) => {
      const pickRegion = vi.fn(() => Promise.resolve([target]));
      const { workbench, getInteraction } = harness(
        undefined,
        pickRegion,
        createInteractionState(),
        granularity,
      );

      await workbench.selectBox(complete());

      expect(pickRegion).toHaveBeenCalledWith(rect(), granularity);
      expect(selectedKeys(getInteraction())).toEqual([expected]);
    },
  );

  it.each([
    ["part", "p:1"],
    ["instance", "i:instance-a"],
  ] as const)("supports %s point selection", async (granularity, expected) => {
    const pick = vi.fn(() => Promise.resolve(faceHit));
    const { workbench, getInteraction } = harness(
      pick,
      undefined,
      createInteractionState(),
      granularity,
    );

    await workbench.click({ clientX: 100, clientY: 100 } as MouseEvent);

    expect(selectedKeys(getInteraction())).toEqual([expected]);
  });

  it("selects an owning element while keeping the exact pick in inspection", async () => {
    const pick = vi.fn(() => Promise.resolve(nodeHit));
    const { workbench, getInteraction, inspectionPanel } = harness(pick);

    await workbench.click({ clientX: 100, clientY: 100 } as MouseEvent);

    expect(selectedKeys(getInteraction())).toEqual(["e:instance-a:2"]);
    expect(inspectionPanel.textContent).toContain("Node 3");
  });

  it("keeps a modified empty click from clearing element selection", async () => {
    const selected = element("instance-a", 2);
    const initial = setTargetSelected(createInteractionState(), selected, true);
    const { workbench, getInteraction } = harness(undefined, undefined, initial);

    await workbench.click({ clientX: 100, clientY: 100, ctrlKey: true } as MouseEvent);

    expect(selectedKeys(getInteraction())).toEqual(["e:instance-a:2"]);
  });

  it("selects an exact node in Node granularity", async () => {
    const pick = vi.fn(() => Promise.resolve(nodeHit));
    const { workbench, getInteraction } = harness(
      pick,
      undefined,
      createInteractionState(),
      "node",
    );

    await workbench.click({ clientX: 100, clientY: 100 } as MouseEvent);

    expect(selectedKeys(getInteraction())).toEqual(["n:instance-a:3"]);
  });

  it("requests authored edge picking and keeps the stable edge target", async () => {
    const pick = vi.fn(() => Promise.resolve(edgeHit));
    const { workbench, getInteraction, inspectionPanel } = harness(
      pick,
      undefined,
      createInteractionState(),
      "edge",
    );

    await workbench.click({ clientX: 100, clientY: 100 } as MouseEvent);

    expect(pick).toHaveBeenCalledWith(100, 100, "edge");
    expect(selectedKeys(getInteraction())).toEqual(["ed:instance-a:1,2"]);
    expect(inspectionPanel.textContent).toContain("Incident elements 2");
  });

  it("selects the immediately hovered target without a second GPU readback", async () => {
    const pick = vi.fn(() => Promise.resolve(nodeHit));
    const { workbench, getInteraction } = harness(
      pick,
      undefined,
      createInteractionState(),
      "node",
    );
    const event = { clientX: 100, clientY: 100 } as PointerEvent;

    await workbench.hover(event);
    await workbench.click(event);

    expect(selectedKeys(getInteraction())).toEqual(["n:instance-a:3"]);
    expect(pick).toHaveBeenCalledOnce();
  });

  it("promotes a cached face hit to its element when shift-clicked", async () => {
    const pick = vi.fn(() => Promise.resolve(faceHit));
    const { workbench, getInteraction } = harness(
      pick,
      undefined,
      createInteractionState(),
      "face",
    );
    const event = { clientX: 100, clientY: 100 } as PointerEvent;

    await workbench.hover(event);
    await workbench.click(event);
    await workbench.click({ clientX: 100, clientY: 100, shiftKey: true } as MouseEvent);

    expect(selectedKeys(getInteraction())).toEqual(["e:instance-a:2"]);
    expect(pick).toHaveBeenCalledOnce();
  });

  it("clears a stale node hover when a plain click selects another node", async () => {
    const staleHover = { kind: "node", instanceId: "instance-b", nodeId: 8 } as const;
    const pick = vi.fn(() => Promise.resolve(nodeHit));
    const { workbench, getInteraction } = harness(
      pick,
      undefined,
      setTargetHovered(createInteractionState(), staleHover),
      "node",
    );

    await workbench.click({ clientX: 100, clientY: 100 } as MouseEvent);

    expect(selectedKeys(getInteraction())).toEqual(["n:instance-a:3"]);
    expect(hoveredTarget(getInteraction())).toBeUndefined();
  });

  it("keeps a face hit from becoming a node selection", async () => {
    const staleHover = { kind: "node", instanceId: "instance-b", nodeId: 8 } as const;
    const pick = vi.fn(() => Promise.resolve(faceHit));
    const { workbench, getInteraction, inspectionPanel } = harness(
      pick,
      undefined,
      setTargetHovered(createInteractionState(), staleHover),
      "node",
    );

    await workbench.click({ clientX: 100, clientY: 100 } as MouseEvent);

    expect(selectedKeys(getInteraction())).toEqual([]);
    expect(hoveredTarget(getInteraction())).toBeUndefined();
    expect(inspectionPanel.textContent).toContain("Face");
  });

  it("clears transient hover without changing selection or highlights", () => {
    const selected = element("instance-a", 2);
    const initial = setTargetHovered(
      setTargetHighlighted(
        setTargetSelected(createInteractionState(), selected, true),
        selected,
        true,
      ),
      selected,
    );
    const { workbench, getInteraction, render } = harness(undefined, undefined, initial);

    workbench.clearHover();

    expect(hoveredTarget(getInteraction())).toBeUndefined();
    expect(isTargetSelected(getInteraction(), selected)).toBe(true);
    expect(isTargetHighlighted(getInteraction(), selected)).toBe(true);
    expect(render).not.toHaveBeenCalled();
  });

  it("does not let a canvas leave clear a hierarchy-owned hover", () => {
    const hierarchyTarget = { kind: "instance", instanceId: "hierarchy" } as const;
    const ownership = {
      canClear: vi.fn(() => false),
      mark: vi.fn(),
      clear: vi.fn(),
    };
    const { workbench, getInteraction } = harness(
      undefined,
      undefined,
      setTargetHovered(createInteractionState(), hierarchyTarget),
      "element",
      { hoverOwnership: ownership },
    );

    workbench.clearHover();

    expect(hoveredTarget(getInteraction())).toEqual(hierarchyTarget);
    expect(ownership.canClear).toHaveBeenCalledOnce();
    expect(ownership.clear).not.toHaveBeenCalled();
  });
});
