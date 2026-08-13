const COMMIT_URL_BASE = "https://github.com/dirkphilip/femgx/commit/";
const FULL_SHA = /^[0-9a-f]{40}$/i;

export interface BuildInfoPresentation {
  readonly timestamp: string;
  readonly shortRevision: string | undefined;
  readonly commitUrl: string | undefined;
}

/** Formats the private build metadata used by the static demo shell. */
export function buildInfoPresentation(timestamp: string, revision: string): BuildInfoPresentation {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) throw new Error("Build timestamp must be a valid ISO date");
  const fullRevision = FULL_SHA.test(revision) ? revision.toLowerCase() : undefined;
  return {
    timestamp: `Built ${utcTimestamp(date)}`,
    shortRevision: fullRevision?.slice(0, 7),
    commitUrl: fullRevision === undefined ? undefined : `${COMMIT_URL_BASE}${fullRevision}`,
  };
}

/** Renders one accessible build marker without making a runtime metadata request. */
export function renderBuildInfo(target: HTMLElement): void {
  const presentation = buildInfoPresentation(buildTimestamp(), buildRevision());
  target.replaceChildren();
  target.append(`${presentation.timestamp} · `);
  if (presentation.shortRevision === undefined || presentation.commitUrl === undefined) {
    target.append("local build");
    return;
  }
  const link = document.createElement("a");
  link.href = presentation.commitUrl;
  link.textContent = presentation.shortRevision;
  link.setAttribute("aria-label", `Source commit ${presentation.shortRevision}`);
  target.append(link);
}

function buildTimestamp(): string {
  return typeof __FEMGX_BUILD_TIMESTAMP__ === "string"
    ? __FEMGX_BUILD_TIMESTAMP__
    : new Date().toISOString();
}

function buildRevision(): string {
  return typeof __FEMGX_BUILD_SHA__ === "string" ? __FEMGX_BUILD_SHA__ : "";
}

function utcTimestamp(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} UTC`;
}
