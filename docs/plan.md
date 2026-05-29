# PrayRequest

> Every PR is a PrayRequest.
> 合併之前，先讀一段。

A GitHub bot that drops a context-aware Bible verse on every Pull Request —
matched to the title, description, and diff. Just the verse and the reference;
readers interpret it however they want.

---

## TL;DR

| | |
|---|---|
| **What** | GitHub bot that comments a Bible verse on PRs, matched to the PR's context |
| **Why** | Team's YOLO-PR culture has no artifact. Canonize the vibe. |
| **How** | GitHub App on Cloudflare Workers → Claude Haiku 4.5 (Workers AI binding) → POST comment |
| **Cost** | ~$0.002 per PR. ~$2/month at 1,000 PRs. |
| **Build effort** | PoC in 1 day. MVP in 2–3 days. |
| **Risk** | Religious sensitivity → opt-in per repo, alternate quote sources optional. |

---

## The Pitch

**Problem.** YOLO PRs — Friday 6pm hotfixes, no-test merges, 3,000-line
refactors, "I'll add tests later" — are a recurring team meme but leave
no artifact. The vibe deserves canonization.

**Solution.** PrayRequest auto-comments a fitting Bible verse and reference.
It reads the PR context (title, description, diff shape) and picks scripture
that matches the energy. No editorial commentary — the verse stands alone.

**Why it works.**
- **Context-aware, not random.** A `hotfix` PR gets a different verse than a
  refactor. That's the joke.
- **No commentary, no offense.** Verse + reference only. The reader does the
  interpretation. Lowers religious-sensitivity risk and makes the bot easy to
  localize without rewriting tone.
- **Low-cost to run.** Cloudflare Workers free tier swallows everything
  pre-viral. ~$0.002/PR for the LLM call once v1 lands.
- **Opt-in per PR.** Auto-bless only fires when `@prayrequest` appears
  in the PR title or body. Repos that install the App don't get a
  verse on every PR — only on the ones that ask for one.

---

## What It Does

Three trigger modes:

| Mode | Trigger | Behavior |
|---|---|---|
| **Auto-bless** | PR opened / ready_for_review *with `@prayrequest` in title or body* | Drop one verse + reference on PR open |
| **Summon** | `@prayrequest` in any PR comment | Reply contextually to the thread |
| **Reroll** | `@prayrequest reroll` | Generate an alternate verse if the first didn't land |

Optional future modes:
- **Last rites** — verse on merge ("rest in peace, prod")
- **Point-blessing** — `@prayrequest bless @reviewer` to bless someone else
- **Daily verse** — scheduled team-wide verse via repo discussions

---

## How It Works

```
┌─────────────────┐
│  GitHub PR /    │ opened / commented
│  comment event  │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────┐
│  Cloudflare Worker          │
│  /webhook                   │
│                             │
│  1. Verify HMAC signature   │
│  2. Mint installation token │
│  3. Extract context:        │
│     • title + description   │
│     • diff stats            │
│     • file paths touched    │
│     • signals (no tests,    │
│       hotfix, security,     │
│       TODO/FIXME, size)     │
└────────┬────────────────────┘
         │
         ▼
┌─────────────────────────────┐
│  Claude Haiku 4.5           │
│  (Workers AI env.AI binding)│
│                             │
│  System prompt asks for:    │
│  • Bible verse matching     │
│    the PR's energy          │
│  • Reference (book ch:v)    │
│  • JSON output              │
│  (No commentary — verse     │
│   speaks for itself)        │
└────────┬────────────────────┘
         │
         ▼
┌─────────────────────────────┐
│  POST /repos/:o/:r/         │
│  issues/:n/comments         │
│  (installation token)       │
└─────────────────────────────┘
```

### Trigger detection

The Worker subscribes to `pull_request` and `issue_comment` webhook events.
It dispatches on `X-GitHub-Event`. PR comments arrive as `issue_comment` because
GitHub treats PRs as a subtype of issues at the API layer.

### Signal extraction

Before calling Claude, the Worker enriches the PR with cheap heuristic signals
that bias verse selection:

| Signal | Detection | Vibe |
|---|---|---|
| Friday-late hotfix | title contains `hotfix\|urgent`, time after 5pm Fri | YOLO max |
| No tests | diff touches `src/` but no `test\|spec` files | faith-without-works |
| Security path | files in `auth/\|middleware/\|admin/` | watchman of the city |
| TODO debt | diff adds `TODO\|FIXME\|XXX` | hidden things |
| Massive diff | >500 lines or >20 files changed | new creation |
| Force push | commit count drop | revisionist |

Signals are passed to Claude as structured input so verse matching is
predictable and non-random.

---

## Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Trigger / runtime | **Cloudflare Workers** | Free tier, sub-100ms cold start, native WebCrypto for HMAC + RS256 |
| Web framework | **Hono** | Tiny (~12 KiB), Workers-native routing |
| GitHub auth | **`jose` for App JWT** + raw `fetch` for token exchange | Two endpoints; Octokit would be overkill |
| LLM | **Claude Haiku 4.5** via the Cloudflare Workers AI `env.AI` binding (proxied; billed through Unified Billing) | Accurate bilingual CUV+KJV recall, no reasoning-token trap, no separate API key. Cheap Workers AI models mis-recalled the CUV and couldn't be constrained via the binding. |
| Verse fallback | **Curated JSON** of pre-tagged verses + default | Used if API fails, rate-limits, or hallucinates |
| Config | `.github/prayrequest.yml` per repo (planned) | Verse language, opt-out paths, alternate quote sources |
| Optional analytics | **PostHog** | Track 👍/👎 reactions to learn which verses land |

### Why an App (not an Action)

Earlier drafts shipped as a GitHub Action because it had no infra cost. That
path is gone — the App needs hosted GitHub App credentials (App ID, private
key, webhook secret) and a billing-enabled LLM path anyway, which kills the
"drop two files, no secrets" pitch the Action existed for. The hosted App is
now the only distribution.

| | GitHub App on Workers | (former) Action path |
|---|---|---|
| Setup | Install once at org level | Drop workflow file per repo |
| Latency | sub-100ms cold start | ~10s runner spin-up |
| Auth | App JWT → installation token | Default `GITHUB_TOKEN` |
| LLM secrets | None — Workers AI binding + Unified Billing | Per-repo `ANTHROPIC_API_KEY` |
| Summon UX | `@mention` + (planned) reviewer-add | Workflow listens on `issue_comment` |

#### Request-review as a trigger

GitHub Apps can be added to `requested_reviewers` and respond on
`pull_request: [review_requested]`, the same way CodeRabbit and
Greptile do. So `@prayrequest` could plausibly work both as an
@-mention summon and as a "add the bot as a reviewer" target. The UI
affordance of *appearing in the reviewer picker* without typing is
currently a Copilot-only privilege (first-party integration), but the
underlying API capability exists for any App with the right
permissions. Worth confirming against GitHub docs before locking the
v2 spec.

---

## Costs

Per-PR cost breakdown using Claude Sonnet 4.6 with prompt caching:

| Item | Tokens | Cost |
|---|---|---|
| Cached system prompt | ~800 in (cached) | negligible |
| PR context (title + desc + diff summary) | ~500 in | $0.0015 |
| Output (verse + reference) | ~50 out | $0.0008 |
| **Per PR** | | **~$0.002** |

At 1,000 PRs/month: **~$2**. At 10,000: ~$20. Cloudflare Workers free
tier covers the webhook traffic at this volume.

A Haiku-only "cost mode" cuts this by ~5×.

---

## Roadmap

### v0 — Action PoC ✅ (archived)
Bash + jq workflow that proved the comment plumbing. Removed once the
App took over; the keyword-matching logic moved to TypeScript at
`app/src/verse-picker.ts` and the verse JSON moved with it.

### v2 — Hosted GitHub App: `@prayrequest` ✅
- `app/` — Cloudflare Workers + TypeScript + Hono. Webhook handler
  verifies `X-Hub-Signature-256`, mints installation tokens, posts
  via the App's bot identity.
- Install once at the org or user level, no per-repo workflow file.
- Auto-bless on `pull_request: [opened, ready_for_review]` *only when
  `@prayrequest` is in the PR title or body* (opt-in per PR).
- `@prayrequest` in any PR comment → summon.
- `@prayrequest reroll` → walks the issue's comments, finds the bot's
  last verse, excludes it from the next pick (matched via hidden HTML
  comment anchor `<!-- prayrequest:ref=… -->`).
- Keyword matcher with word-boundary tag matching against PR title,
  JSON-order priority, and a `massive`-tag override for big diffs — now
  the **fallback** beneath the v1 LLM (see below).
- Open: **Request-review as trigger** — add `@prayrequest` as a
  reviewer, respond on `pull_request: [review_requested]`. Underlying
  API supports this for any App; UI sidebar prominence may stay
  Copilot-only. To be confirmed.

### v1 — Claude-powered matching ✅
- `pickVerseWithLLM` in `app/src/verse-picker.ts` calls Claude Haiku 4.5
  with PR context (title + description + diff size + recent commits).
- Reached via the Cloudflare Workers AI `env.AI` binding (proxied
  `anthropic/*`) — **no `ANTHROPIC_API_KEY`**; needs Unified Billing
  enabled on the account instead.
- Validates the reference against the Bible canon (`bible-canon.ts`) and
  falls back to the keyword matcher on failure, timeout, or invalid ref.
- Same surface (auto-bless, summon, reroll), smarter picks.
- Still pending: deterministic signal extraction, hybrid ref→canonical-text
  lookup, prompt caching, and the daily per-repo comment cap (Cloudflare KV).

### v3 — Polish (open-ended)
- React-emoji feedback loop (👍/👎 → log to PostHog)
- Verse-fatigue dampening (don't repeat same verse within N PRs)
- Per-repo config (`.github/prayrequest.yml`): language, alternate quote
  sources (Tao Te Ching, Sun Tzu, Shakespeare for non-religious teams)
- Publish App on Marketplace, landing page, docs

---

## Sample Interactions

> Each scenario assumes the author included `@prayrequest` in the PR
> title or body to opt in. Without that, auto-bless is silent.

### Friday 6:47pm hotfix
**PR:** `@prayrequest hotfix: payment gateway timeout (URGENT)` — +3 / −1, no tests

> > 人若賺得全世界，賠上自己的生命，有甚麼益處呢？
> > — *馬太福音 16:26*
>
> *— 🙏 PrayRequest*

### Massive refactor
**PR:** `refactor: rewrite auth module` — +2,847 / −3,102, 30 files

> > 看哪，我將一切都更新了。
> > — *啟示錄 21:5*
>
> *— 🙏 PrayRequest*

### No tests added
**PR:** `feat: add user export to CSV` — +312 / −4, 0 test files

> > 信心若沒有行為就是死的。
> > — *雅各書 2:17*
>
> *— 🙏 PrayRequest*

### Security path touched
**PR:** `fix: bypass JWT check for internal calls` — touches `middleware/auth.ts`

> > 若不是耶和華看守城池，看守的人就枉然儆醒。
> > — *詩篇 127:1*
>
> *— 🙏 PrayRequest*

### TODO debt
**Diff:**
```diff
+ // TODO: handle edge case when user has no email
+ // FIXME: this is a hack, refactor later
```

> > 掩蓋自己罪過的，必不亨通；承認且離棄罪過的，必蒙憐恤。
> > — *箴言 28:13*
>
> *— 🙏 PrayRequest*

---

## Risks & Considerations

| Risk | Mitigation |
|---|---|
| **Religious sensitivity** | Opt-in per repo. Allow alternate quote sources (Tao Te Ching, Sun Tzu, Shakespeare). Verse + reference only — no editorial commentary, so the bot never appears to be mocking the verse or the author. |
| **Cost runaway** | Daily comment cap per repo. Fallback to curated verse list if API errors. Skip bot-authored PRs. |
| **Spam fatigue** | Auto-bless is opt-in per PR (`@prayrequest` must appear in title or body); silent on every PR that doesn't ask for it. Don't auto-bless on `synchronize` events (only initial open). |
| **Verse repetition** | Track recently-used verses per repo, dampen reuse within N PRs. |
| **LLM hallucination of verses** | Validate Claude's output against a known verse index; fall back to curated list if reference doesn't exist. |
| **Verse–context mismatch** | Maintain a small eval set of PR scenarios + expected verse category; run before each prompt change. |

---

## Open Questions

1. **Default language: English, Cantonese, or bilingual?** Bilingual is the
   most "us" but verbose in comments.
2. **Should it bless reviewers too, or only authors?** Reviewer-blessing is
   funnier but adds noise.
3. **App reviewer integration**: confirm `requested_reviewers` works for a
   third-party App without Copilot-tier UI privileges. If yes, advertise
   "add `@prayrequest` as a reviewer" as a first-class summon mode (and
   solves the autocomplete-discoverability gap).
4. **Marketplace listing**: keep private install (single-link) or publish
   on the Marketplace for public discovery. Marketplace requires a verified
   publisher, listing copy, screenshots, and a separate review process.

---

## Comment format

```
> [verse]
> — *[reference]*

*— 🙏 PrayRequest*
```

---

## Next Step

v1 ✅ shipped — App is deployed and installed on this repo; auto-bless +
summon + reroll all work end-to-end, and verse selection is LLM-driven
(Claude Haiku 4.5 via the Workers AI binding) with the keyword matcher as
fallback.

**Next**: the items deferred from v1 — deterministic signal extraction
before the LLM call, the hybrid ref→canonical-text lookup (so recalled
verse text is verified, not just the reference), prompt caching, and the
daily per-repo comment cap (Cloudflare KV) as the runaway-cost guard.
