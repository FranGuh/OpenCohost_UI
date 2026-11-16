import { defineConfig, transformWithEsbuild } from "vite";
import { fileURLToPath } from "node:url";

// Builds the React-free phone avatar to the gateway's static folder.
// Run with: pnpm build:phone-avatar
const entry = fileURLToPath(new URL("./src/phone-avatar/entry.ts", import.meta.url));
const outDir = fileURLToPath(new URL("../opencohost/gateway/static", import.meta.url));

// Vite skips whitespace/comment minification for ES library output; run a full pass
// so no documentation comments (and their URLs) ship in the bundle.
const fullMinify = {
  name: "phone-avatar-full-minify",
  async renderChunk(code: string) {
    const out = await transformWithEsbuild(code, "avatar.js", { minify: true, legalComments: "none", target: "es2020", format: "esm" });
    return { code: out.code, map: null };
  },
};

export default defineConfig({
  plugins: [fullMinify],
  publicDir: false,
  logLevel: "info",
  esbuild: { legalComments: "none" },
  build: {
    target: "es2020",
    outDir,
    emptyOutDir: false,
    sourcemap: false,
    minify: "esbuild",
    copyPublicDir: false,
    lib: { entry, formats: ["es"], fileName: () => "avatar.js" },
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
