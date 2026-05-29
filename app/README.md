# PrayRequest GitHub App

The hosted Worker that powers the `@prayrequest` bot. Cloudflare Workers
+ TypeScript + Hono. Receives GitHub webhooks, picks a verse with Claude
Haiku 4.5 (via the Workers AI binding), and posts a comment as the App's
bot user.

> Verse selection is LLM-driven (`pickVerseWithLLM` in
> `src/verse-picker.ts`); the curated keyword matcher (`pickVerse`) is the
> fallback when the model call fails, times out, or returns an invalid ref.

---

## What lives here

| File | Purpose |
|---|---|
| `src/index.ts` | Hono app, `/webhook` route, signature verify, dispatch |
| `src/verify.ts` | HMAC-SHA256 verification of `X-Hub-Signature-256` |
| `src/github-auth.ts` | App JWT (RS256 via `jose`) → installation token, with per-isolate cache |
| `src/github-api.ts` | `postComment`, `findLastBotComment`, `getPullRequest`, `extractRefFromBody` |
| `src/verse-picker.ts` | `pickVerseWithLLM` (Claude Haiku 4.5 via `env.AI`) + `pickVerse` keyword fallback (loads `../../.github/prayrequest-verses.json`; word-boundary, JSON-order priority, massive-diff override). Validates refs against `bible-canon.ts`. |
| `src/handlers/pull-request.ts` | Auto-bless on `opened` / `ready_for_review` |
| `src/handlers/issue-comment.ts` | `@prayrequest` summon, `@prayrequest reroll` |
| `test/index.spec.ts` | Verse-picker parity tests (vitest) |

---

## One-time setup

### 1. Register the GitHub App

Visit https://github.com/settings/apps/new and create an App with:

| Field | Value |
|---|---|
| GitHub App name | `PrayRequest` (the slug becomes `prayrequest`, bot user is `prayrequest[bot]`) |
| Homepage URL | https://github.com/williamchong/pray-request (or your fork) |
| Webhook → Active | ☑ |
| Webhook URL | leave blank for now — fill in after first deploy |
| Webhook secret | generate a random string, save it; you'll set it as `GITHUB_WEBHOOK_SECRET` |
| Repository permissions | **Pull requests: Read and write**, **Issues: Read-only**, **Metadata: Read-only** |
| Subscribe to events | ☑ Pull request, ☑ Issue comment |
| Where can this GitHub App be installed? | Only on this account (private), or Any account (public) |

After create:
- Note the **App ID** at the top of the settings page.
- Scroll down and **Generate a private key**. A `.pem` file downloads.
- Convert it to PKCS#8 (the format `jose` expects):
  ```bash
  openssl pkcs8 -topk8 -in your-app.pem -out app-pkcs8.pem -nocrypt
  ```
  (GitHub gives PKCS#1; Web Crypto on Workers wants PKCS#8.)

### 2. Set Cloudflare secrets

```bash
cd app
npx wrangler login
npx wrangler secret put GITHUB_APP_ID            # paste the numeric App ID
npx wrangler secret put GITHUB_WEBHOOK_SECRET    # paste the random string from step 1
npx wrangler secret put GITHUB_APP_PRIVATE_KEY < app-pkcs8.pem
```

> **Enable Unified Billing for the LLM.** Verse selection calls the proxied
> `anthropic/claude-haiku-4.5` model through the Workers AI `env.AI` binding.
> Proxied (non-`@cf/`) models route through AI Gateway and require **Unified
> Billing** enabled on your Cloudflare account (Dashboard → **AI → AI
> Gateway**) — without it the call errors `2021: Invalid User Credentials` and
> the bot silently falls back to the keyword matcher. ~$0.0018/PR. No API key
> of your own is needed; Cloudflare manages the provider credentials.

### 3. Deploy

```bash
npx wrangler deploy
```

Wrangler prints a URL like `https://prayrequest.<your-subdomain>.workers.dev`. Go back to the App settings and set:

- **Webhook URL** = `https://prayrequest.<your-subdomain>.workers.dev/webhook`

### 4. Install on a repo

From the App's public install page (linked in the App settings), pick a
test repo. Open a PR with `@prayrequest` somewhere in the title or
body — auto-bless fires. Or open a normal PR and comment
`@prayrequest` to summon. Comment `@prayrequest reroll` to skip the
last verse the bot posted in this thread.

---

## Local development

```bash
cd app
npm install --ignore-scripts          # --ignore-scripts skips a transitive sharp build
npx wrangler dev                       # http://localhost:8787
```

For local secrets, create `app/.dev.vars` (gitignored):

```
GITHUB_APP_ID=12345
GITHUB_WEBHOOK_SECRET=local-dev-secret
GITHUB_APP_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

For end-to-end webhook testing, forward GitHub events to localhost via
[smee.io](https://smee.io):

```bash
npx smee-client --url https://smee.io/<your-channel> --target http://localhost:8787/webhook
```

(Set the App's webhook URL to the smee.io channel during dev.)

### Tests

```bash
npx vitest run
```

Verse-picker tests cover the matcher's behavior: massive override,
word-boundary matching, default fallback, reroll-exclude.

---

## Operational notes

**Token caching.** Installation tokens are cached per-installation in
the Worker isolate's memory for ~50min (they live 60min). Cold
isolates re-mint; that's an extra ~150ms but fine. If you see
auth-error noise, bump the cache TTL down or clear the cache between
deploys.

**Webhook timeouts.** GitHub's webhook delivery times out at 10s. We
ack with `{accepted:true}` immediately and run handlers via
`ctx.waitUntil`, so a slow GitHub-API round-trip doesn't trigger
redelivery storms.

**Errors.** Handler errors are `console.error`-logged (visible in
`wrangler tail`) but not surfaced to GitHub — webhook redelivery is
opt-in and noisy, and a 500 on every retry would mask the real error
in logs.

**LLM verse selection.** `pickVerseWithLLM` calls `anthropic/claude-haiku-4.5`
via `env.AI` and falls back to the keyword matcher on any failure. Each
branch logs a distinct line — grep `pickVerseWithLLM:` in `wrangler tail`
(`LLM verse selected` = real pick; the rest = fallback). Two Workers AI
gotchas worth knowing before swapping models: the native `env.AI.run()`
binding **silently ignores** OpenAI-style control params (`reasoning_effort`,
`response_format`, `guided_json` — only honored on `/v1/chat/completions`),
and proxied `anthropic/*`/`google/*` models need Unified Billing (see setup).

**Daily comment cap.** Not implemented yet. Required per
`docs/plan.md`; will land as a Cloudflare KV-backed counter
(`prayrequest:cap:<repo>:<yyyy-mm-dd>`) in a follow-up.

**Reroll detection.** `@prayrequest reroll` walks the issue's comment
history (`per_page=100`, last page) and finds the most recent comment
whose author login starts with `prayrequest` and whose `user.type` is
`Bot`. The previous verse's reference is parsed back out of that
comment's body and excluded from the next pick.

---

## Cost expectations

- Cloudflare Workers free tier: 100K requests/day. PrayRequest's
  webhook volume is bounded by PR + comment volume on installed repos,
  which for personal/small-team use is ~10s of events/day. Free tier
  swallows it.
- Outbound GitHub API calls: 1 per auto-bless (post comment, after
  cached token), 2–3 per summon/reroll (get PR + post + maybe list
  comments). Far below the 5,000/hr per-installation rate limit.
- LLM: one Claude Haiku 4.5 call per verse (~500 in / ~250 out tokens),
  billed through Workers AI Unified Billing at ~$0.0018/PR — under the
  plan's ~$0.002/PR ceiling. No prompt caching yet. The daily per-repo
  comment cap (still TODO) is the real runaway-cost guard.

---

## Why Workers (vs Vercel / Fly / Lambda)

- Free tier covers anything pre-viral.
- Sub-100ms cold start vs ~10s for an Actions runner — feels native.
- WebCrypto is built in: HMAC verify and RS256 signing without npm
  packages with native bindings.
- `ctx.waitUntil` for post-response async work fits the webhook model.
- One file (`wrangler.jsonc`) of infra config, vs Dockerfile + healthcheck.

The whole bundle is ~34 KiB gzipped.
