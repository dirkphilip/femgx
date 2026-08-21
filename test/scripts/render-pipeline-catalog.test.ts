import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "../..");
const RENDERER = join(ROOT, "src/renderer");
const CATALOG = join(ROOT, "wiki/rendering/pipeline-families.md");
const PIPELINE_CREATION =
  /(?:\bcreateValidatedRenderPipeline|\.createRenderPipeline(?:Async)?)\s*\(/u;

function rendererSources(): readonly string[] {
  return readdirSync(RENDERER, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
    .map((entry) => join(entry.parentPath, entry.name));
}

describe("render pipeline family catalog", () => {
  it("links every renderer module that creates a render pipeline", () => {
    const catalog = readFileSync(CATALOG, "utf8");
    const creationModules = rendererSources()
      .filter((file) => PIPELINE_CREATION.test(readFileSync(file, "utf8")))
      .map((file) => relative(ROOT, file).split(sep).join("/"))
      .sort();
    const catalogModules = [
      ...new Set(
        [...catalog.matchAll(/\(\.\.\/\.\.\/(src\/renderer\/[^)#]+\.ts)\)/gu)].map(
          (match) => match[1],
        ),
      ),
    ].sort();

    expect(creationModules).not.toHaveLength(0);
    expect(catalogModules).toEqual(creationModules);
  });
});
