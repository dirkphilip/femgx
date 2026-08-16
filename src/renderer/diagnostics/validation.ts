/** A compilation diagnostic surfaced by an internal renderer validation seam. */
export interface GpuCompilationDiagnostic {
  readonly label: string;
  readonly type: GPUCompilationMessage["type"];
  readonly message: string;
  readonly lineNum: number;
  readonly linePos: number;
  readonly offset: number;
  readonly length: number;
}

type CompilationMessage = Pick<
  GPUCompilationMessage,
  "type" | "message" | "lineNum" | "linePos" | "offset" | "length"
>;

/** Internal hooks used by focused tests and the demo's deterministic failure seam. */
export interface GpuValidationOptions {
  readonly onDiagnostic?: (diagnostic: GpuCompilationDiagnostic) => void;
  readonly shaderFailureLabel?: string;
}

/** Internal error type that distinguishes shader/pipeline validation from hardware support. */
export class GpuValidationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "GpuValidationError";
  }
}

const TEST_SHADER_FAILURE_KEY = "__FEMGX_TEST_SHADER_FAILURE__";

/** Reads the demo-only shader failure seam without adding public API surface. */
export function readGpuValidationOptions(): GpuValidationOptions | undefined {
  const value = (globalThis as Record<string, unknown>)[TEST_SHADER_FAILURE_KEY];
  return typeof value === "string" ? { shaderFailureLabel: value } : undefined;
}

/** Creates a shader module and waits for browser-native compilation diagnostics. */
export async function createValidatedShaderModule(
  device: GPUDevice,
  label: string,
  code: string,
  options: GpuValidationOptions = {},
): Promise<GPUShaderModule> {
  let module: GPUShaderModule;
  let info: GPUCompilationInfo;
  try {
    module = device.createShaderModule({ label, code });
    info = await module.getCompilationInfo();
  } catch (error) {
    throw shaderError(label, error);
  }
  const messages = injectedMessages(label, info.messages, options.shaderFailureLabel);
  const diagnostics = messages.map((message) => toDiagnostic(label, message));
  for (const diagnostic of diagnostics) {
    if (diagnostic.type !== "error") reportDiagnostic(diagnostic, options.onDiagnostic);
  }
  const errors = diagnostics.filter((diagnostic) => diagnostic.type === "error");
  if (errors.length > 0) {
    throw new GpuValidationError(errors.map(formatDiagnostic).join("\n"));
  }
  return module;
}

/** Creates a render pipeline and waits for validation errors from its scope. */
export async function createValidatedRenderPipeline(
  device: GPUDevice,
  label: string,
  descriptor: GPURenderPipelineDescriptor,
): Promise<GPURenderPipeline> {
  return createValidatedPipeline(label, () =>
    device.createRenderPipelineAsync({ ...descriptor, label }),
  );
}

/** Creates a compute pipeline and waits for validation errors from its scope. */
export async function createValidatedComputePipeline(
  device: GPUDevice,
  label: string,
  descriptor: GPUComputePipelineDescriptor,
): Promise<GPUComputePipeline> {
  return createValidatedPipeline(label, () =>
    device.createComputePipelineAsync({ ...descriptor, label }),
  );
}

async function createValidatedPipeline<T>(label: string, create: () => Promise<T>): Promise<T> {
  try {
    return await create();
  } catch (error) {
    throw pipelineError(label, error);
  }
}

function injectedMessages(
  label: string,
  messages: readonly CompilationMessage[],
  failureLabel: string | undefined,
): readonly CompilationMessage[] {
  if (failureLabel === undefined || !label.includes(failureLabel)) return messages;
  return [
    {
      type: "error",
      message: `Injected shader failure for ${label}`,
      lineNum: 1,
      linePos: 2,
      offset: 3,
      length: 4,
    },
    ...messages,
  ];
}

function toDiagnostic(label: string, message: CompilationMessage): GpuCompilationDiagnostic {
  return {
    label,
    type: message.type,
    message: message.message,
    lineNum: message.lineNum,
    linePos: message.linePos,
    offset: message.offset,
    length: message.length,
  };
}

function reportDiagnostic(
  diagnostic: GpuCompilationDiagnostic,
  onDiagnostic: ((diagnostic: GpuCompilationDiagnostic) => void) | undefined,
): void {
  if (onDiagnostic !== undefined) {
    onDiagnostic(diagnostic);
    return;
  }
  console.warn(formatDiagnostic(diagnostic));
}

function formatDiagnostic(diagnostic: GpuCompilationDiagnostic): string {
  const location = [
    diagnostic.lineNum > 0 ? `line ${diagnostic.lineNum}` : undefined,
    diagnostic.linePos > 0 ? `column ${diagnostic.linePos}` : undefined,
    diagnostic.offset >= 0 ? `offset ${diagnostic.offset}` : undefined,
  ]
    .filter((part): part is string => part !== undefined)
    .join(", ");
  return `[${diagnostic.label}] ${diagnostic.message}${location === "" ? "" : ` (${location})`}`;
}

function pipelineError(label: string, error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  return new GpuValidationError(`[${label}] ${message}`);
}

function shaderError(label: string, error: unknown): GpuValidationError {
  const message = error instanceof Error ? error.message : String(error);
  return new GpuValidationError(`[${label}] ${message}`);
}
