/**
 * Vitest Configuration - Project-Local Customizations
 *
 * api-creator tests use bare describe/it/expect (globals mode)
 * and live in test/ (not tests/).
 * @see https://vitest.dev/config/
 * @module vitest.config.local
 */
import type { ViteUserConfig } from "vitest/config";

const config: ViteUserConfig = {
  test: {
    globals: true,
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
  },
};

export default config;
