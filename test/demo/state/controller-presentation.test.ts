import { describe, expect, it, vi } from "vitest";
import { WorkbenchController } from "../../../demo/workbench/controllers/controller";
import { IDLE_RENDER_LOOP_STATS } from "../../../demo/workbench/viewport/render-loop";
import type { WorkbenchViewportSlot } from "../../../demo/workbench/viewport/viewport-slots";
import type { ViewportSlotId } from "../../../demo/workbench/viewport/view";

describe("workbench controller presentation publication", () => {
  it("publishes due continuous frame statistics but respects the throttle", () => {
    const { controller, sync, publish, onRender } = controllerForRender(true);

    controller.onViewportRender("primary", 1_000);
    controller.onViewportRender("primary", 1_100);

    expect(onRender).toHaveBeenCalledTimes(2);
    expect(sync).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledOnce();
  });

  it("does not add a snapshot publication to non-continuous rendering", () => {
    const { controller, sync, publish } = controllerForRender(false);

    controller.onViewportRender("primary", 1_000);

    expect(sync).toHaveBeenCalledOnce();
    expect(publish).not.toHaveBeenCalled();
  });

  it("does not publish a late continuous frame after disposal", () => {
    const { controller, publish } = controllerForRender(true, true);

    controller.onViewportRender("primary", 1_000);

    expect(publish).not.toHaveBeenCalled();
  });
});

function controllerForRender(
  continuous: boolean,
  disposed = false,
): {
  readonly controller: WorkbenchController;
  readonly sync: ReturnType<typeof vi.fn>;
  readonly publish: ReturnType<typeof vi.fn>;
  readonly onRender: ReturnType<typeof vi.fn>;
} {
  const sync = vi.fn();
  const publish = vi.fn();
  const onRender = vi.fn().mockReturnValueOnce(true).mockReturnValue(false);
  const slot = {
    id: "primary" as const,
    pane: {
      canvas: {
        getBoundingClientRect: () => ({ width: 300, height: 200 }),
      },
    },
    renderLoop: { reset: vi.fn(), stats: IDLE_RENDER_LOOP_STATS },
  } as unknown as WorkbenchViewportSlot;
  const controller = Object.create(WorkbenchController.prototype) as WorkbenchController;
  Object.assign(controller as unknown as Record<string, unknown>, {
    continuousEnabled: continuous,
    disposed,
    observedPaneSizes: new Map<
      ViewportSlotId,
      { size: { width: number; height: number }; devicePixelRatio: number }
    >(),
    viewportSlots: {
      get: (slotId: ViewportSlotId) => (slotId === "primary" ? slot : undefined),
      onRender,
    },
    syncViewportPresentation: sync,
    publishSnapshot: publish,
  });
  return { controller, sync, publish, onRender };
}
