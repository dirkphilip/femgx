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
      entry: {
        femgx: resolve(import.meta.dirname, "src/entries/root.ts"),
        model: resolve(import.meta.dirname, "src/entries/model.ts"),
        io: resolve(import.meta.dirname, "src/entries/io.ts"),
        "io/glb": resolve(import.meta.dirname, "src/entries/io/glb.ts"),
        camera: resolve(import.meta.dirname, "src/entries/camera.ts"),
        runtime: resolve(import.meta.dirname, "src/entries/runtime.ts"),
        platform: resolve(import.meta.dirname, "src/entries/platform.ts"),
      },
      name: "femgx",
      formats: ["es"],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    sourcemap: true,
  },
  plugins: [
    dts({
      include: ["src"],
      outDirs: ["dist"],
      beforeWriteFile(filePath, content) {
        if (filePath.endsWith(".d.ts")) return { filePath, content: esmSpecifiers(content) };
      },
    }),
  ],
});
