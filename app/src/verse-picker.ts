import versesData from "../../.github/prayrequest-verses.json";
import { parseRef, refsAgree } from "./bible-canon";

export interface Verse {
	verse: string;
	ref: string;
	// Secondary-language translation: English KJV in `alt`, with Chinese
	// 和合本 / CUV in the primary `verse`/`ref`. Set both by the LLM path and
	// by the keyword-matcher fallback when the curated JSON entry includes an
	// `alt`; absent only if a curated entry omits one, in which case the
	// comment renders mono-Chinese.
	alt?: { verse: string; ref: string };
}

interface VersesFile {
	verses: Array<Verse & { tags: string[] }>;
	default: Verse;
}

const data = versesData as VersesFile;

// Word-boundary uses an explicit non-alnum class instead of \b because
// \b counts _ as inside-word — `_fix_` would not match `\bfix\b`.
const compiledVerses = data.verses.map((v) => ({
	verse: v.verse,
	ref: v.ref,
	alt: v.alt,
	tags: v.tags,
	patterns: v.tags.map(
		(tag) =>
			new RegExp(
				`(?:^|[^a-z0-9])${tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:[^a-z0-9]|$)`,
			),
	),
}));

export interface VerseInput {
	prTitle: string;
	additions: number;
	changedFiles: number;
	excludeRef?: string;
}

export interface LLMVerseInput extends VerseInput {
	/** Untrusted PR description. Interpolated as LLM prompt data; exits the Worker via JSON.stringify in the AI binding. */
	prBody: string | null;
	/** Commit subjects. Bounded by the caller to keep the prompt small; empty when unavailable. */
	commits: string[];
}

// Generation mode: model recalls a verse freely from its training. Once we
// have a curated verse index, this should switch to hybrid (model picks a
// ref → we look up the canonical text from the index) so hallucinated
// chapter:verse pairs get caught before they're posted.
//
// Claude Haiku 4.5, reached through the same `env.AI` binding (Cloudflare
// proxies anthropic/* models — no separate API key, but the account must have
// Unified Billing enabled or the call errors "2021: Invalid User Credentials").
// Chosen over the cheap Workers AI reasoning models because their
// Traditional-CUV recall was unreliable and — the non-obvious part — the
// native binding silently drops the params that would tame their thinking
// (reasoning_effort / response_format / guided_json), so they spent the whole
// token budget reasoning and returned content:null. Haiku has no reasoning
// trap, for ~$0.0018/PR. Response is Anthropic Messages-shaped
// (content:[{text}]); see extractText.
const LLM_MODEL = "anthropic/claude-haiku-4.5";

// PRs occasionally paste 10k-line stack traces, release notes, or migration
// scripts into the description. 1500 chars (~400 tokens) is enough prose for
// the model to grasp intent without ballooning per-PR cost.
const MAX_BODY_CHARS = 1500;

// Caps Haiku's output. The bilingual answer is 4 string fields (~150-200
// tokens; long Chinese verses hit ~120-180 by themselves). Haiku emits the
// JSON directly with no reasoning trace to budget for, so 512 is comfortable
// headroom and keeps cost ~$0.0018/PR, under the $0.002 ceiling.
const LLM_MAX_TOKENS = 512;

// Worker handlers run inside `waitUntil`, so a hung model call would keep the
// request slot alive until the platform timeout. Bound it ourselves and fall
// through to the keyword matcher on timeout. Haiku typically answers in a
// couple seconds; 10s is generous headroom without leaving a stuck request
// hanging.
const LLM_TIMEOUT_MS = 10000;

function isMassiveChange(input: VerseInput): boolean {
	return input.additions > 500 || input.changedFiles > 20;
}

const SYSTEM_PROMPT = `You are PrayRequest, a bot that comments on GitHub pull requests with a single Bible verse that thematically resonates with the change. Every comment is bilingual: Traditional Chinese (和合本 / CUV, 1919) and English (KJV / King James Version). Both translations are public-domain so the bot can quote them in full without licensing concerns.

Rules:
- Respond ONLY with valid JSON of shape:
  {"verse_zh": "...", "ref_zh": "...", "verse_en": "...", "ref_en": "..."}
- "verse_zh" is the verse text in the Chinese Union Version (和合本 / CUV, 1919 edition), Traditional script. Exact text — do not paraphrase, modernize, or use a later revision (do NOT use 和合本修訂版 / RCUV).
- "ref_zh" is the canonical Chinese reference (e.g. "詩篇 23:1", "馬太福音 16:26", "羅馬書 8:28").
- "verse_en" is the same verse in KJV (King James Version, 1611/1769). Exact text, including archaic forms (Thee/Thou/Thy, Hath/Saith). Do NOT modernize or substitute NIV/ESV phrasing.
- "ref_en" is the same canonical reference in English (e.g. "Psalm 23:1", "Matthew 16:26", "Romans 8:28").
- All four fields are required and must refer to the same verse.
- No commentary, no markdown, no code fences, no editorial interpretation.
- Choose a real verse you are confident exists. Do not invent references.
- Match the PR's theme (fix → restoration, feat → creation, refactor → renewal, security → vigilance, docs → wisdom, test → discernment, etc.).`;

// Minimal AI binding surface we depend on — accepts both the typed `Ai`
// global from worker-configuration.d.ts and a hand-rolled fake in tests.
export interface AiLike {
	run(
		model: string,
		inputs: Record<string, unknown>,
		options?: { signal?: AbortSignal },
	): Promise<unknown>;
}

export async function pickVerseWithLLM(ai: AiLike, input: LLMVerseInput): Promise<Verse> {
	try {
		const raw = await ai.run(
			LLM_MODEL,
			{
				// Anthropic Messages shape: the system prompt is a top-level
				// `system` field, not a system-role message. `messages` carries
				// only the user turn.
				system: SYSTEM_PROMPT,
				messages: [{ role: "user", content: buildUserContent(input) }],
				temperature: 0.7,
				max_tokens: LLM_MAX_TOKENS,
			},
			{ signal: AbortSignal.timeout(LLM_TIMEOUT_MS) },
		);
		const text = extractText(raw);
		// These three branches all fall back to the keyword matcher, which emits
		// the same bilingual shape as a real LLM pick — so without a log they're
		// indistinguishable from success. Log raw/text on the parse failures
		// (the single most useful artifact when the model misbehaves). Server-side
		// only; model output is never interpolated back into a posted comment.
		if (!text) {
			// JSON.stringify so nested response objects aren't truncated to
			// `[Object]` by the log inspector — we need the full shape to see
			// why no text came back (unexpected response format, empty content).
			console.warn("pickVerseWithLLM: no text extracted from model response", JSON.stringify(raw));
			return pickVerse(input);
		}
		const parsed = parseVerseJson(text);
		if (!parsed) {
			console.warn("pickVerseWithLLM: unparseable or invalid verse JSON", { text });
			return pickVerse(input);
		}
		// Model occasionally re-picks the excluded ref despite the prompt; reroll
		// loses its point if we post the same verse back, so fall through. Check
		// both translations because the previous comment's anchor could have
		// been set under either language.
		if (
			input.excludeRef &&
			(parsed.ref === input.excludeRef || parsed.alt?.ref === input.excludeRef)
		) {
			console.warn("pickVerseWithLLM: model re-picked excluded ref, falling back", {
				ref: parsed.ref,
				excludeRef: input.excludeRef,
			});
			return pickVerse(input);
		}
		console.log("pickVerseWithLLM: LLM verse selected", { ref: parsed.ref });
		return parsed;
	} catch (err) {
		console.warn("pickVerseWithLLM: fell back to keyword matcher (error)", err);
		return pickVerse(input);
	}
}

function buildUserContent(input: LLMVerseInput): string {
	const body = (input.prBody ?? "").slice(0, MAX_BODY_CHARS).trim();
	const sizeNote = isMassiveChange(input) ? " (large change)" : "";
	const lines = [
		`PR title: ${input.prTitle}`,
		`Additions: ${input.additions}, files changed: ${input.changedFiles}${sizeNote}`,
	];
	if (body) lines.push(`PR description:\n${body}`);
	if (input.commits.length > 0) {
		lines.push(`Recent commits:\n${input.commits.map((m) => `- ${m}`).join("\n")}`);
	}
	if (input.excludeRef) {
		lines.push(
			`The reader did not connect with "${input.excludeRef}". Pick a different verse on a related but distinct theme.`,
		);
	}
	return lines.join("\n\n");
}

// Normalizes the three response shapes we may see across model families:
// - Anthropic Messages (claude-* proxied): `content` is an array of blocks;
//   the text block holds the answer. This is the current LLM_MODEL's shape.
// - OpenAI chat completions (`choices[0].message.content`) — Workers AI native
//   text models and the OpenAI-compatible endpoint.
// - Legacy `BaseAiTextGeneration` (`{ response: string }`).
// Accepting all three means a future model swap doesn't break extraction.
function extractText(raw: unknown): string | null {
	if (typeof raw === "string") return raw;
	if (typeof raw !== "object" || raw === null) return null;
	const r = raw as {
		response?: unknown;
		content?: Array<{ text?: unknown }>;
		choices?: Array<{ message?: { content?: unknown } }>;
	};
	if (Array.isArray(r.content)) {
		const block = r.content.find((b) => typeof b?.text === "string");
		if (block) return block.text as string;
	}
	if (typeof r.response === "string") return r.response;
	const content = r.choices?.[0]?.message?.content;
	return typeof content === "string" ? content : null;
}

export function parseVerseJson(raw: string): Verse | null {
	// Strip ``` fences models sometimes add despite the no-markdown instruction.
	const fenced = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
	// Non-greedy: parse only the first {...} when the model emits prose
	// around the JSON or two candidate objects.
	const match = fenced.match(/\{[\s\S]*?\}/);
	if (!match) return null;
	let obj: unknown;
	try {
		obj = JSON.parse(match[0]);
	} catch {
		return null;
	}
	if (typeof obj !== "object" || obj === null) return null;
	// Bilingual is the expected shape; mono is a regression-safety net so a
	// stripped-down model response still produces a postable comment.
	const primary = extractPair(obj, "verse_zh", "ref_zh");
	const alt = extractPair(obj, "verse_en", "ref_en");
	if (primary && alt) {
		// Both refs validated against the canon individually in extractPair;
		// here we cross-check they name the same verse so a prompt-drifting
		// model that pairs 詩篇 23:1 with Matthew 5:1 falls through.
		if (!refsAgree(primary.ref, alt.ref)) return null;
		return { ...primary, alt };
	}
	return extractPair(obj, "verse", "ref");
}

function validVerseText(v: unknown): string | null {
	if (typeof v !== "string") return null;
	const t = v.trim();
	if (t.length < 5 || t.length > 500) return null;
	// Untrusted LLM output gets interpolated into formatComment's markdown
	// with no escaping. Reject:
	// - newlines (break out of the blockquote into raw markdown — fake bot
	//   signatures, phishing links)
	// - @ (GitHub renders @-mentions inside blockquotes; the bot's own
	//   comment could ping @victim from a malicious model output)
	// - [ ] (form markdown link/image syntax: [text](url), ![alt](url) —
	//   phishing link and tracking-pixel injection)
	// - < (forms HTML tags — GitHub renders <img>, <a>, <details> inside
	//   blockquotes; also catches <!-- which would spoof the trailing
	//   prayrequest:ref anchor extractRefFromBody parses for reroll)
	// - --> (orphan HTML-comment close; defense-in-depth for the < rule)
	// - http(s):// / www. (GitHub auto-links raw URLs inside blockquotes)
	// Parens are deliberately allowed — verses use parenthetical notes
	// occasionally, and the link/image attacks are already defeated by
	// killing brackets. False-positive avoidance over symmetry.
	if (/[\r\n@\[\]<]|-->|https?:\/\/|www\./i.test(t)) return null;
	return t;
}

// Canon validation rejects unknown book names and out-of-bounds chapters —
// strictly tighter than the old shape-only regex, which let hallucinated
// books like "Hezekiah 3:14" through to the BibleGateway link layer.
function validRef(r: unknown): string | null {
	if (typeof r !== "string") return null;
	const t = r.trim();
	return parseRef(t) !== null ? t : null;
}

function extractPair(
	obj: object,
	verseKey: string,
	refKey: string,
): { verse: string; ref: string } | null {
	const o = obj as Record<string, unknown>;
	const verse = validVerseText(o[verseKey]);
	if (verse === null) return null;
	const ref = validRef(o[refKey]);
	if (ref === null) return null;
	return { verse, ref };
}

// Strips internal fields (tags, patterns) and returns just the public Verse
// shape. Propagates `alt` so the keyword fallback renders bilingual when the
// curated JSON entry has CUV + KJV.
function toVerse(v: { verse: string; ref: string; alt?: Verse["alt"] }): Verse {
	return v.alt ? { verse: v.verse, ref: v.ref, alt: v.alt } : { verse: v.verse, ref: v.ref };
}

export function pickVerse(input: VerseInput): Verse {
	const { prTitle, excludeRef } = input;
	const titleLc = prTitle.toLowerCase();

	if (isMassiveChange(input)) {
		const massive = compiledVerses.find((v) => v.tags.includes("massive"));
		if (massive && massive.ref !== excludeRef) return toVerse(massive);
	}

	for (const v of compiledVerses) {
		if (v.ref === excludeRef) continue;
		if (v.patterns.some((p) => p.test(titleLc))) return toVerse(v);
	}

	if (data.default.ref !== excludeRef) return toVerse(data.default);

	const fallback = compiledVerses.find((v) => v.ref !== excludeRef);
	if (fallback) return toVerse(fallback);
	return toVerse(data.default);
}

// Map each comment language to the BibleGateway version code we prompted
// the LLM for. Keep in sync with SYSTEM_PROMPT's translation rules: the
// Chinese slot is 和合本 (CUV, 1919) and the English slot is KJV. Both
// public-domain — see SYSTEM_PROMPT for the matching translation contract.
const GATEWAY_VERSIONS = { zh: "CUV", en: "KJV" } as const;

export function verseGatewayUrl(ref: string, lang: keyof typeof GATEWAY_VERSIONS): string {
	const params = new URLSearchParams({ search: ref, version: GATEWAY_VERSIONS[lang] });
	return `https://www.biblegateway.com/passage/?${params}`;
}

function renderRefBlock(verse: string, ref: string, lang: keyof typeof GATEWAY_VERSIONS): string {
	return `> ${verse}\n> — *[${ref}](${verseGatewayUrl(ref, lang)})*`;
}

// Trailing HTML comment is the canonical anchor for reroll's exclude-ref
// lookup. Parsing visible markdown back out (the > —*ref* line) would
// silently break if formatting ever changes. The anchor uses the primary
// ref so it's stable across mono fallback and bilingual paths.
//
// Refs are markdown-linked to BibleGateway. The alt slot is always KJV
// per the bilingual contract; the primary slot derives its version from
// parseRef's matched language (CUV when the canon's Chinese map hit,
// KJV when the English map hit) so a mono-English LLM fallback doesn't
// render English text under a Chinese-version link. Falls back to CUV when
// parseRef fails — the keyword-matcher fallback only emits CJK refs.
export function formatComment(v: Verse): string {
	const primaryLang = parseRef(v.ref)?.lang ?? "zh";
	const blocks = [renderRefBlock(v.verse, v.ref, primaryLang)];
	if (v.alt) blocks.push(renderRefBlock(v.alt.verse, v.alt.ref, "en"));
	blocks.push("*— 🙏 PrayRequest*");
	return `${blocks.join("\n\n")}\n<!-- prayrequest:ref=${v.ref} -->`;
}
