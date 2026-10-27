import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Relative base so the build works from a GitHub Pages sub-path.
  base: "./",
  plugins: [react()],
  test: { include: ["src/**/*.test.ts"] },
});
