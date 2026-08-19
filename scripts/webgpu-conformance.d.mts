export interface ConformanceRunner {
  readonly status: string;
  readonly labels: ReadonlyArray<{ readonly name: string }>;
}

export interface ConformanceMatrixEntry {
  readonly target: string;
  readonly name: string;
  readonly runner: string;
  readonly state: "available" | "unavailable" | "not-requested";
}

export interface ConformanceEvidence {
  readonly schemaVersion: number;
  readonly kind: string;
  readonly capturedAt: string;
  readonly target: string | null;
  readonly platform: string;
  readonly browser?: { readonly name?: string; readonly version?: string };
  readonly adapter?: {
    readonly vendor?: string;
    readonly architecture?: string;
    readonly device?: string;
    readonly description?: string;
    readonly isFallbackAdapter?: boolean;
  } | null;
  readonly assertions?: Readonly<Record<string, boolean>>;
  readonly captures?: ReadonlyArray<{ readonly name: string }>;
}

export const CONFORMANCE_TARGETS: ReadonlyArray<{
  readonly id: string;
  readonly name: string;
  readonly runnerLabel: string;
}>;

export function conformanceRunnerMatrix(
  runners: ReadonlyArray<ConformanceRunner>,
  requested: ReadonlyArray<string>,
): ReadonlyArray<ConformanceMatrixEntry>;

export function summarizeConformance(
  evidenceRecords: ReadonlyArray<ConformanceEvidence>,
  requiredTargets: ReadonlyArray<string>,
): { readonly markdown: string; readonly missing: ReadonlyArray<string> };
