import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

// `remoteBindings: false` skips vitest-pool-workers' remote-proxy session
// bootstrap. The proxy is needed for bindings without a local stub (Workers
// AI is the only one we use), but our tests inject a fake AI via
// pickVerseWithLLM's AiLike parameter — the real binding is never touched.
// Without this, CI fails on pool startup since there's no `wrangler login`
// / CLOUDFLARE_API_TOKEN to authenticate the proxy.
export default defineWorkersConfig({
	test: {
		poolOptions: {
			workers: {
				wrangler: { configPath: "./wrangler.jsonc" },
				remoteBindings: false,
			},
		},
	},
});
