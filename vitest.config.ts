// vitest.config.ts
// Global Vitest configuration for the AKIRA project.

import { defineConfig, configDefaults } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  // The application's Vite config gets the "@/*" -> "./src/*" alias injected by
  // @lovable.dev/vite-tanstack-config. Vitest does not load that config when a
  // vitest.config.ts is present, so without this plugin the alias resolves in
  // the app build but not under test, and any test whose module graph reaches a
  // runtime `@/...` import dies with "Cannot find package". Reading tsconfig.json
  // keeps the alias defined in exactly one place.
  plugins: [tsconfigPaths()],
  test: {
    exclude: [...configDefaults.exclude, "archive/**"],
  },
});
