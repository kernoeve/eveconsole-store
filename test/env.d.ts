import type { Bindings } from "../src/env";

// The bindings the tests' `env` carries: wrangler.toml's plus the secrets vitest.config.ts sets.
// `cloudflare:test` types `env` as Cloudflare.Env, the interface `wrangler types` would generate.
declare global {
  namespace Cloudflare {
    interface Env extends Bindings {}
  }
}
export {};
