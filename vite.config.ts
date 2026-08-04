import { resolve } from "node:path";
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

function esmSpecifiers(content: string): string {
  return content.replace(
    /(from\s+['"])(\.\.?\/[^'"]+)(['"])/g,
    (_match, prefix, specifier, suffix) => {
      const path = specifier as string;
      const extension = /\.[a-z]+$/.test(path) ? "" : ".js";
      return `${prefix}${path}${extension}${suffix}`;
    },
  );
}

export default defineConfig({
  build: {
    lib: {
      entry: resolve(import.meta.dirname, "src/index.ts"),
      name: "femgx",
      fileName: "femgx",
    },
    sourcemap: true,
  },
  plugins: [
    dts({
      include: ["src"],
      exclude: ["src/fixture/**"],
      outDirs: ["dist", { dir: "dist/cjs", moduleFormat: "cjs" }],
      beforeWriteFile(filePath, content) {
        const isEsm = filePath.endsWith(".d.ts");
        const isCts = filePath.endsWith(".d.cts");
        if (isEsm) return { filePath, content: esmSpecifiers(content) };
        if (isCts)
          return { filePath, content: esmSpecifiers(content).replace(/\.js(['"])/g, ".cts$1") };
      },
    }),
  ],
});
