import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs"],
  target: "node20",
  clean: true,
  // The modules under vendor/shared are compiled in. commander and zod stay
  // ordinary npm dependencies.
  noExternal: ["shared"],
});
