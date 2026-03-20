/**
 * Vitest Configuration - Project-Local Customizations
 * @see https://vitest.dev/config/
 * @module vitest.config.local
 */
import type { ViteUserConfig } from "vitest/config";

const config: ViteUserConfig = {
  test: {
    coverage: {
      exclude: ["src/types/**", "src/recorder/**", "src/cli.ts"],
    },
  },
};

export default config;
