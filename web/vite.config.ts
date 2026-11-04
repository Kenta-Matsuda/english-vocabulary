import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

// Relative base so the build works on GitHub Pages (/<repo>/) and locally.
export default defineConfig({
  base: "./",
  plugins: [preact()],
});
