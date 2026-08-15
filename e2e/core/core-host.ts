import {
  createFemViewport,
  createPart,
  createScene,
  identity,
  WebGpuUnsupportedError,
  type FemViewport,
} from "../../src/index";

const canvasElement = document.querySelector<HTMLCanvasElement>("#core-canvas");
const statusElement = document.querySelector<HTMLOutputElement>("#core-status");
if (canvasElement === null || statusElement === null) {
  throw new Error("core host markup is incomplete");
}
const canvas = canvasElement;
const status = statusElement;
let viewport: FemViewport | undefined;

const hostWindow = window as typeof window & {
  femgxCore?: { destroy: () => void };
};

function setStatus(result: string, message: string): void {
  status.dataset["result"] = result;
  status.textContent = message;
}

function coreScene() {
  const part = createPart(1, {
    geometries: [
      {
        positions: new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]),
        indices: new Uint32Array([0, 1, 2]),
        primitive: "triangles",
      },
    ],
  });
  return createScene()
    .addPart(part)
    .addAssembly({
      id: 1,
      name: "core-foundation",
      placements: [{ kind: "part", partId: part.id, transform: identity() }],
    })
    .withRoot(1)
    .build();
}

async function start(): Promise<void> {
  const scene = coreScene();
  let frames = 0;
  try {
    viewport = await createFemViewport({
      canvas,
      scene,
      onRender: () => {
        frames += 1;
        canvas.dataset["frames"] = String(frames);
      },
    });
    hostWindow.femgxCore = {
      destroy: () => {
        viewport?.destroy();
        viewport = undefined;
        setStatus("destroyed", "Core viewport destroyed");
      },
    };
    canvas.dataset["ready"] = "true";
    setStatus("ready", "Core viewport ready");
  } catch (error) {
    if (error instanceof WebGpuUnsupportedError) {
      setStatus("unsupported", `${error.name}:${error.reason}`);
      return;
    }
    setStatus("error", error instanceof Error ? error.message : String(error));
    throw error;
  }
}

window.addEventListener("beforeunload", () => viewport?.destroy(), { once: true });
void start();
