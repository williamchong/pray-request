// Augment the wrangler-generated Env with bindings/secrets that aren't picked
// up by the stale `worker-configuration.d.ts` checked into the repo. Secrets
// set via `wrangler secret put` are never inferred (they aren't in
// wrangler.jsonc); the `AI` binding is declared in wrangler.jsonc but won't
// appear here until the next `wrangler types` regen — declare it explicitly
// so editor + tsc both see it. Keep in sync with app/README.md.
declare namespace Cloudflare {
	interface Env {
		GITHUB_APP_ID: string;
		GITHUB_APP_PRIVATE_KEY: string;
		GITHUB_WEBHOOK_SECRET: string;
		AI: Ai;
	}
}
