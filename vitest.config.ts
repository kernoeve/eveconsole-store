import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.toml" },
      miniflare: {
        compatibilityFlags: ["nodejs_compat"],
        bindings: {
          STORE_SYNC_SECRET: "test-secret-do-not-use",
          EVE_CLIENT_ID: "test-client",
          EVE_CLIENT_SECRET: "test-secret",
          SITE_VERSION: "test",
        },
      },
    }),
  ],
});
