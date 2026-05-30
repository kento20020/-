import { defineConfig } from "vite";

// base: './' = 相対パス。GitHub Pages の project pages（/<repo>/）でも
// user pages（/）でもリポジトリ名をハードコードせず動く。
export default defineConfig({
  base: "./",
  build: {
    target: "es2022",
    outDir: "dist",
    emptyOutDir: true,
  },
});
