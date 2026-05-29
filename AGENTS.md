# AGENTS.md

This file provides guidance to AI coding agents (Claude Code, Cursor, Aider, Codex, etc.) working with code in this repository. `CLAUDE.md` is a symlink to this file for tools that auto-discover by that name.

> Note: when this file mentions **the verse-picking LLM** (Claude Haiku 4.5, reached through the Cloudflare Workers AI `env.AI` binding — see `app/src/verse-picker.ts`), it refers to the model the *product* calls to pick verses — not the agent reading this file. Don't conflate the two when editing.

## Repository status

**v1 shipped — LLM verse selection is live.** Source of truth for product intent is `docs/plan.md`.

The hosted App lives at `app/` (Cloudflare Workers + TypeScript + Hono). It receives webhooks at `/webhook`, verifies HMAC, mints installation tokens, and posts verse comments under the App's bot identity. There is no longer a separate Action / self-host path — the App is the only distribution.

**Working in this repo:**

- `app/` is a TypeScript Cloudflare Workers project. Install with `npm install --ignore-scripts` (sharp's postinstall fails and isn't needed). Tests: `cd app && npx vitest run`. Type check: `cd app && npx tsc --noEmit`. Bundle dry-run: `cd app && npx wrangler deploy --dry-run`.
- Verse data lives at `.github/prayrequest-verses.json` (legacy location from the v0 Action; the App imports it via `../../.github/prayrequest-verses.json`). Moving it is a future cleanup.
- The repo root is otherwise non-code: `README.md`, `AGENTS.md`, `docs/plan.md`. Don't introduce package.json, scripts/, or other tooling outside `app/`.

**v1 (LLM-powered verse selection) shipped.** `pickVerseWithLLM` in `app/src/verse-picker.ts` calls Claude Haiku 4.5 (via the Workers AI `env.AI` binding) with PR context — title, description, diff size, recent commit subjects — and the curated keyword matcher (`pickVerse`) is the fallback when the call fails, times out, or returns an unparseable/invalid reference. Still pending from the plan: deterministic signal extraction, the hybrid ref→canonical-text lookup, prompt caching, and the daily per-repo comment cap.

## What PrayRequest is

A GitHub bot that comments a context-matched Bible verse on every PR — verse + reference only, no commentary. Readers interpret it themselves. See `docs/plan.md` for full pitch, sample interactions, and tradeoff rationale.

## Architecture

```
PR / comment event → Worker /webhook → HMAC verify → installation token mint
  → Claude Haiku 4.5 (Workers AI env.AI binding) → validate ref against Bible canon
  → POST comment        (keyword matcher fallback on any LLM failure)
```

Three trigger modes:

| Mode        | Event                                          | Behavior                          |
|-------------|------------------------------------------------|-----------------------------------|
| Auto-bless  | `pull_request: [opened, ready_for_review]` with `@prayrequest` in title or body | Drop verse on PR open |
| Summon      | `issue_comment: [created]` containing `@prayrequest` | Reply contextually to the thread |
| Reroll      | `issue_comment` containing `@prayrequest reroll` | Generate an alternate verse |

**Signal extraction** (planned, not yet shipped) would run *before* the LLM call to bias verse selection deterministically (hotfix detection, no-tests heuristic, security-path detection, TODO debt, massive-diff, force-push). Shipped v1 passes only raw PR context (title, body, diff size, commit subjects) to the model; the one deterministic signal wired in is the massive-diff override, and it lives in the keyword fallback. Full signal table in `docs/plan.md` § Signal extraction.

**Verse fallback + validation:** the curated JSON of pre-tagged verses is the fallback for LLM failures, timeouts, and rate limits. The model's output is validated before posting — `parseVerseJson` checks the reference against the Bible canon (`bible-canon.ts`) and runs security filters on the text — but there is no canonical-text index yet, so the model's *recalled verse text* is posted as-is once the ref validates. The hybrid "model picks a ref → look up trusted text" design is still future.

## Non-negotiable constraints from the plan

These are decisions already made — do **not** revisit without explicit user direction:

- **Opt-in per repo** (App must be installed) **and per PR** (`@prayrequest` must appear in PR title or body for auto-bless to fire; comment summon is always explicit). Skip bot-authored PRs (Dependabot, Renovate). Religious sensitivity → never on by default for someone else's repo, never on by accident on someone's PR.
- **Verse + reference only — no editorial commentary.** The bot does not add snark, sass, or interpretation. Readers project their own meaning onto the verse. This is a deliberate product decision (made post-plan): it lowers religious-sensitivity risk and makes the bot localizable without rewriting tone.
- **Don't auto-bless on `synchronize` events** — only initial open — to avoid spam on every push.
- **Cost ceiling: ~$0.002/PR.** Shipped v1 uses Claude Haiku 4.5 via Workers AI Unified Billing at ~$0.0018/PR. No prompt caching yet (the proxied `env.AI` binding path doesn't expose `cache_control`). A daily per-repo comment cap is still required to prevent runaway cost and is not yet implemented.
- **Per-repo config** lives at `.github/prayrequest.yml` (language, opt-out paths, alternate quote sources like Tao Te Ching / Sun Tzu / Shakespeare for non-religious teams). Not yet implemented.

## App implementation notes

Things in `app/` that are easy to break by accident:

- **Two entry points: LLM, then keyword fallback.** Handlers call `pickVerseWithLLM(env.AI, …)`, which calls Claude Haiku 4.5 and falls back to `pickVerse` (the keyword matcher below) on any failure. Every exit logs a distinct line — grep `pickVerseWithLLM:` in `wrangler tail` — so a silent keyword fallback is distinguishable from a real LLM pick (`LLM verse selected`).
- **The native `env.AI.run()` binding silently drops OpenAI-style control params.** `reasoning_effort`, `response_format`, and `guided_json` are accepted without error but have *no effect* via the binding — they're only honored on the `/v1/chat/completions` OpenAI-compatible endpoint. This is why a Workers AI reasoning model (gemma-4) couldn't be constrained and spent its whole budget on a `reasoning` field returning `content:null`. Don't re-introduce a reasoning model expecting these knobs to work via the binding.
- **Proxied models require Unified Billing.** `anthropic/*` (and `google/*`) models via `env.AI` route through AI Gateway and error `2021: Invalid User Credentials` unless Unified Billing is enabled on the Cloudflare account. Native `@cf/` models are keyless. Switching to/from a proxied model means checking this.
- **`extractText` normalizes three response shapes** — Anthropic Messages (`content[0].text`, the current model), OpenAI (`choices[0].message.content`), and legacy (`{ response }`) — so a model swap doesn't break extraction.
- **Verse priority is JSON order.** `pickVerse` in `app/src/verse-picker.ts` walks `verses[]` and picks the first one with any tag matching the (lowercased) PR title. Reorder carefully — putting `feat` before `security` would make every `feat: add admin endpoint` match `feat` not `security`.
- **Tag matching uses ASCII word-boundary** (`(^|[^a-z0-9])tag([^a-z0-9]|$)`) so `fix` doesn't match `prefix` and `auth` doesn't match `author`. JS `\b` includes `_`, so it's *not* equivalent — keep the explicit non-alnum class.
- **`massive` tag is a special override.** When `additions > 500` or `changed_files > 20`, the matcher short-circuits to the first verse tagged `massive`. Currently that's the refactor verse.
- **Hidden HTML anchor in bot comments.** `formatComment` appends `<!-- prayrequest:ref=… -->` so reroll's `extractRefFromBody` can recover the previous verse without parsing visible markdown. Don't strip this — it's how reroll-exclude works.
- **`@prayrequest` literal is mirrored in the App's `SUMMON_PATTERN`** (`app/src/summon.ts`). Both handlers (auto-bless and summon) import from there. Keep the regex in one place.
- **Webhook payload security.** `comment.body` and `pull_request.body` are untrusted; never interpolate them into a shell command or a JSON request via string concatenation. The Worker uses `JSON.stringify` and `crypto.subtle.verify` exclusively.

## Open questions still live in the plan

`docs/plan.md` § Open Questions lists unresolved decisions (Marketplace publish vs internal, default language, bless-reviewers, request-review trigger). If your task touches one of these, surface the question to the user before picking a direction.
