import "@angular/compiler";
import { Injector, type DestroyableInjector } from "@angular/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ViewportOptions } from "femgx";
import { AngularApplicationState } from "../../demo/angular/src/state/application-state";
import { ViewportCoordinator } from "../../demo/angular/src/effects/viewport/viewport-coordinator";

const mocks = vi.hoisted(() => ({ createViewport: vi.fn() }));

vi.mock("femgx", () => ({
  createViewport: mocks.createViewport,
  WebGpuUnsupportedError: class WebGpuUnsupportedError extends Error {},
}));

interface FakeViewport {
  readonly destroy: ReturnType<typeof vi.fn<() => void>>;
  readonly recover: ReturnType<typeof vi.fn<() => Promise<unknown>>>;
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function fakeViewport(): FakeViewport {
  return { destroy: vi.fn(), recover: vi.fn() };
}

describe("ViewportCoordinator", () => {
  let injector: DestroyableInjector;

  beforeEach(() => {
    injector = Injector.create({
      providers: [
        { provide: AngularApplicationState, useClass: AngularApplicationState },
        { provide: ViewportCoordinator, useClass: ViewportCoordinator },
      ],
    });
    mocks.createViewport.mockReset();
  });

  afterEach(() => {
    injector.destroy();
  });

  it("destroys a viewport that completes after owner destruction", async () => {
    const pending = deferred<FakeViewport>();
    mocks.createViewport.mockReturnValue(pending.promise);
    const coordinator = injector.get(ViewportCoordinator);
    const start = coordinator.start({} as HTMLCanvasElement, {} as never);

    coordinator.destroy();
    const viewport = fakeViewport();
    pending.resolve(viewport);
    await start;

    expect(viewport.destroy).toHaveBeenCalledOnce();
    expect(coordinator.lifecycle()).toEqual({ status: "destroyed" });
  });

  it("rejects a startup viewport after terminal recovery failure", async () => {
    const pending = deferred<FakeViewport>();
    let options!: ViewportOptions;
    mocks.createViewport.mockImplementation((nextOptions: ViewportOptions) => {
      options = nextOptions;
      return pending.promise;
    });
    const coordinator = injector.get(ViewportCoordinator);
    const start = coordinator.start({} as HTMLCanvasElement, {} as never);
    const failure = new Error("startup recovery failed");

    options.onDeviceLost?.({ message: "startup device loss" } as Parameters<
      NonNullable<ViewportOptions["onDeviceLost"]>
    >[0]);
    options.onError?.(failure);
    const viewport = fakeViewport();
    pending.resolve(viewport);
    await start;

    expect(viewport.destroy).toHaveBeenCalledOnce();
    expect(coordinator.lifecycle()).toEqual({ status: "failed", message: failure.message });
  });

  it("publishes recovery success and terminal recovery failure", async () => {
    const viewport = fakeViewport();
    let options!: ViewportOptions;
    mocks.createViewport.mockImplementation((nextOptions: ViewportOptions) => {
      options = nextOptions;
      return Promise.resolve(viewport);
    });
    const coordinator = injector.get(ViewportCoordinator);
    await coordinator.start({} as HTMLCanvasElement, {} as never);
    expect(coordinator.lifecycle()).toEqual({ status: "ready" });

    const recovery = deferred<undefined>();
    viewport.recover.mockImplementation(async () => {
      await recovery.promise;
      options.onRecovered?.();
    });
    const notifyDeviceLoss = (): void => {
      options.onDeviceLost?.({ message: "test loss" } as Parameters<
        NonNullable<ViewportOptions["onDeviceLost"]>
      >[0]);
      void viewport.recover();
    };
    notifyDeviceLoss();
    expect(coordinator.lifecycle()).toEqual({ status: "starting" });
    expect(viewport.recover).toHaveBeenCalledOnce();
    recovery.resolve(undefined);
    await Promise.resolve();
    await vi.waitFor(() => {
      expect(coordinator.lifecycle()).toEqual({ status: "ready" });
    });

    const failure = new Error("device recovery failed");
    viewport.recover.mockImplementation(() => {
      options.onError?.(failure);
      return Promise.resolve();
    });
    notifyDeviceLoss();
    await vi.waitFor(() => {
      expect(coordinator.lifecycle()).toEqual({ status: "failed", message: failure.message });
    });
    await coordinator.recover();
    expect(viewport.recover).toHaveBeenCalledTimes(2);
  });
});
