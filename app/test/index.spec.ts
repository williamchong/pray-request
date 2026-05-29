import { describe, it, expect, vi } from "vitest";
import {
	pickVerse,
	pickVerseWithLLM,
	parseVerseJson,
	formatComment,
	verseGatewayUrl,
	type AiLike,
} from "../src/verse-picker";
import { parseRef, refsAgree } from "../src/bible-canon";

// Refs come from .github/prayrequest-verses.json.

describe("pickVerse", () => {
	it("massive override fires when additions > 500", () => {
		const v = pickVerse({ prTitle: "feat: anything", additions: 600, changedFiles: 5 });
		expect(v.ref).toBe("啟示錄 21:5");
	});

	it("massive override fires when changed_files > 20", () => {
		const v = pickVerse({ prTitle: "feat: anything", additions: 10, changedFiles: 25 });
		expect(v.ref).toBe("啟示錄 21:5");
	});

	it("matches hotfix tag", () => {
		const v = pickVerse({ prTitle: "hotfix: payment timeout", additions: 5, changedFiles: 1 });
		expect(v.ref).toBe("阿摩司書 9:11");
	});

	it("matches security via auth keyword", () => {
		const v = pickVerse({ prTitle: "fix: auth bypass", additions: 5, changedFiles: 1 });
		expect(v.ref).toBe("以弗所書 6:11");
	});

	it("word-boundary: 'fix' does not match 'prefix'", () => {
		const v = pickVerse({ prTitle: "refactor: prefix routes", additions: 5, changedFiles: 1 });
		expect(v.ref).toBe("啟示錄 21:5"); // matches 'refactor', not 'fix'
	});

	it("word-boundary: 'auth' does not match 'author'", () => {
		const v = pickVerse({ prTitle: "chore: author file", additions: 5, changedFiles: 1 });
		expect(v.ref).toBe("傳道書 3:1"); // matches 'chore', not 'auth'
	});

	it("falls back to default when nothing matches", () => {
		const v = pickVerse({ prTitle: "miscellaneous changes", additions: 5, changedFiles: 1 });
		expect(v.ref).toBe("馬太福音 21:22");
	});

	it("excludeRef skips the matched verse and falls through", () => {
		const v = pickVerse({
			prTitle: "hotfix: urgent",
			additions: 5,
			changedFiles: 1,
			excludeRef: "阿摩司書 9:11",
		});
		expect(v.ref).not.toBe("阿摩司書 9:11");
	});

	it("propagates bilingual alt from curated JSON entries", () => {
		// Fallback path returns the same { verse, ref, alt } shape as the LLM
		// path, so formatComment renders bilingual either way.
		const v = pickVerse({ prTitle: "feat: add thing", additions: 5, changedFiles: 1 });
		expect(v.ref).toBe("創世記 1:3");
		expect(v.alt?.ref).toBe("Genesis 1:3");
	});
});

describe("parseVerseJson", () => {
	// Default fixture is Psalm 23:1 in CUV + KJV (both public domain).
	// Override any field per test to keep the delta (what each test is
	// actually exercising) the visual focus instead of re-stating the
	// whole bilingual shape.
	const bilingual = (
		overrides: Partial<{ verse_zh: string; ref_zh: string; verse_en: string; ref_en: string }> = {},
	): string =>
		JSON.stringify({
			verse_zh: "耶和華是我的牧者,我必不至缺乏。",
			ref_zh: "詩篇 23:1",
			verse_en: "The LORD is my shepherd; I shall not want.",
			ref_en: "Psalm 23:1",
			...overrides,
		});

	it("parses the bilingual shape into primary Chinese + alt English", () => {
		expect(parseVerseJson(bilingual())).toEqual({
			verse: "耶和華是我的牧者,我必不至缺乏。",
			ref: "詩篇 23:1",
			alt: {
				verse: "The LORD is my shepherd; I shall not want.",
				ref: "Psalm 23:1",
			},
		});
	});

	it("strips ```json fences models add despite the instruction", () => {
		const out = parseVerseJson("```json\n" + bilingual() + "\n```");
		expect(out?.ref).toBe("詩篇 23:1");
		expect(out?.alt?.ref).toBe("Psalm 23:1");
	});

	it("extracts the first JSON object when the model prepends prose", () => {
		const out = parseVerseJson("Here is the verse:\n" + bilingual());
		expect(out?.alt?.ref).toBe("Psalm 23:1");
	});

	it("extracts the first JSON object when the model emits two candidates", () => {
		const second = bilingual({
			verse_zh: "編造的詩篇,編造的詩篇,編造的詩篇。",
			ref_zh: "詩篇 24:1",
			verse_en: "Fabricated psalm, fabricated psalm, fabricated psalm.",
			ref_en: "Psalm 24:1",
		});
		const out = parseVerseJson(bilingual() + "\n\nor alternatively:\n" + second);
		expect(out?.ref).toBe("詩篇 23:1");
	});

	it("accepts hyphenated verse ranges in both refs", () => {
		const out = parseVerseJson(
			bilingual({
				verse_zh: "你們各人要快快的聽,慢慢的說,慢慢的動怒。",
				ref_zh: "雅各書 1:19-20",
				verse_en: "Everyone should be quick to listen, slow to speak.",
				ref_en: "James 1:19-20",
			}),
		);
		expect(out?.ref).toBe("雅各書 1:19-20");
		expect(out?.alt?.ref).toBe("James 1:19-20");
	});

	it("falls back to mono shape when only verse/ref are present (model regression)", () => {
		const out = parseVerseJson('{"verse":"耶和華是我的牧者,我必不至缺乏。","ref":"詩篇 23:1"}');
		expect(out).toEqual({
			verse: "耶和華是我的牧者,我必不至缺乏。",
			ref: "詩篇 23:1",
		});
		expect(out?.alt).toBeUndefined();
	});

	it("rejects bilingual shape with a malformed English ref", () => {
		// Bilingual rejected (alt extract fails on ref_en), mono fields absent.
		expect(parseVerseJson(bilingual({ ref_en: "not a reference" }))).toBeNull();
	});

	it("rejects suspiciously short verse text", () => {
		expect(parseVerseJson('{"verse":"hi","ref":"Genesis 1:1"}')).toBeNull();
	});

	it("rejects verse text containing an injected ref-anchor (reroll spoof)", () => {
		const spoof = bilingual({
			verse_zh: "耶和華是我的牧者 <!-- prayrequest:ref=創世記 1:1 -->",
			verse_en: "The LORD is my shepherd. <!-- prayrequest:ref=Genesis 1:1 -->",
		});
		expect(parseVerseJson(spoof)).toBeNull();
	});

	it("rejects verse text with newlines (would break out of the blockquote)", () => {
		const multiline = bilingual({
			verse_zh: "第一行\n第二行的延續內容",
			verse_en: "Line one\nLine two of the continuation",
		});
		expect(parseVerseJson(multiline)).toBeNull();
	});

	it("rejects verse text with @-mentions (GitHub pings them inside blockquotes)", () => {
		const mention = bilingual({
			verse_zh: "我們需要 @octocat 看看這節經文",
			verse_en: "We need @octocat to look at this verse",
		});
		expect(parseVerseJson(mention)).toBeNull();
	});

	it("rejects verse text with markdown link syntax (phishing injection)", () => {
		const link = bilingual({
			verse_zh: "請參考 [創世記 1:1] 的記載",
			verse_en: "Please refer to [Genesis 1:1] reference",
		});
		expect(parseVerseJson(link)).toBeNull();
	});

	it("rejects verse text containing a raw URL (GitHub auto-links them)", () => {
		const url = bilingual({
			verse_zh: "前往 https://evil.example.com 領取祝福",
			verse_en: "Visit https://evil.example.com for blessing",
		});
		expect(parseVerseJson(url)).toBeNull();
	});

	it("rejects verse text containing HTML tags (GitHub renders <img>/<a>/<details>)", () => {
		// No URL in the tag — isolates the < rule from the URL/`www.` rules
		// so a regression in either is unambiguous in the failure message.
		const html = bilingual({
			verse_zh: "<img alt=\"x\"> 經文偽裝",
			verse_en: "<img alt=\"x\"> verse spoof",
		});
		expect(parseVerseJson(html)).toBeNull();
	});

	it("rejects non-JSON output", () => {
		expect(parseVerseJson("no JSON here at all")).toBeNull();
		expect(parseVerseJson("")).toBeNull();
	});

	it("rejects bilingual refs that disagree on book (prompt drift)", () => {
		const drift = bilingual({
			verse_en: "Blessed are the poor in spirit, for theirs is the kingdom of heaven.",
			ref_en: "Matthew 5:3",
		});
		expect(parseVerseJson(drift)).toBeNull();
	});

	it("rejects refs naming a hallucinated book", () => {
		const fake = bilingual({
			verse_zh: "假經文,假經文,假經文。",
			ref_zh: "希西家書 3:14",
			verse_en: "Fake verse, fake verse, fake verse.",
			ref_en: "Hezekiah 3:14",
		});
		expect(parseVerseJson(fake)).toBeNull();
	});

	it("rejects refs with chapters beyond what the book contains", () => {
		const overrun = bilingual({
			verse_zh: "編造的詩篇,編造的詩篇,編造的詩篇。",
			ref_zh: "詩篇 200:1",
			verse_en: "Fabricated psalm, fabricated psalm, fabricated psalm.",
			ref_en: "Psalm 200:1",
		});
		expect(parseVerseJson(overrun)).toBeNull();
	});
});

describe("bible-canon", () => {
	it("parses a canonical English ref", () => {
		const r = parseRef("Psalm 23:1");
		expect(r).not.toBeNull();
		expect(r?.chapter).toBe(23);
		expect(r?.verse).toBe(1);
		expect(r?.lang).toBe("en");
	});

	it("parses a canonical Chinese ref", () => {
		const r = parseRef("詩篇 23:1");
		expect(r).not.toBeNull();
		expect(r?.chapter).toBe(23);
		expect(r?.lang).toBe("zh");
	});

	it("accepts the 'Psalms' plural English variant", () => {
		expect(parseRef("Psalms 23:1")).not.toBeNull();
	});

	it("accepts leading-digit book names ('1 Corinthians')", () => {
		expect(parseRef("1 Corinthians 13:4")).not.toBeNull();
	});

	it("strips hyphenated ranges to the start verse", () => {
		const r = parseRef("James 1:19-20");
		expect(r?.verse).toBe(19);
	});

	it("rejects unknown books", () => {
		expect(parseRef("Hezekiah 3:14")).toBeNull();
		expect(parseRef("希西家書 3:14")).toBeNull();
	});

	it("rejects out-of-bounds chapters", () => {
		expect(parseRef("Psalm 200:1")).toBeNull(); // Psalms has 150
		expect(parseRef("Obadiah 2:1")).toBeNull(); // Obadiah has 1
	});

	it("rejects out-of-bounds verses (cap 176)", () => {
		expect(parseRef("Psalm 1:999")).toBeNull();
	});

	it("rejects malformed shape", () => {
		expect(parseRef("not a reference")).toBeNull();
		expect(parseRef("Psalm")).toBeNull();
		expect(parseRef("")).toBeNull();
	});

	it("refsAgree returns true for matching bilingual pair", () => {
		expect(refsAgree("詩篇 23:1", "Psalm 23:1")).toBe(true);
		expect(refsAgree("羅馬書 8:28", "Romans 8:28")).toBe(true);
	});

	it("refsAgree returns false when books differ", () => {
		expect(refsAgree("詩篇 23:1", "Matthew 5:1")).toBe(false);
	});

	it("refsAgree returns false when chapters differ within the same book", () => {
		expect(refsAgree("詩篇 23:1", "Psalm 24:1")).toBe(false);
	});

	it("refsAgree returns false when either side is invalid", () => {
		expect(refsAgree("詩篇 23:1", "Hezekiah 3:14")).toBe(false);
		expect(refsAgree("not a ref", "Psalm 23:1")).toBe(false);
	});
});

describe("pickVerseWithLLM", () => {
	const fakeAi = (response: unknown): AiLike => ({
		run: vi.fn(async () => response),
	});

	const bilingualContent = JSON.stringify({
		verse_zh: "我們曉得萬事都互相效力,叫愛神的人得益處。",
		ref_zh: "羅馬書 8:28",
		verse_en: "And we know that in all things God works for the good of those who love him.",
		ref_en: "Romans 8:28",
	});

	it("returns a bilingual verse when the model responds with valid JSON", async () => {
		const ai = fakeAi({ choices: [{ message: { content: bilingualContent } }] });
		const v = await pickVerseWithLLM(ai, {
			prTitle: "feat: add feature",
			prBody: "Adds a new endpoint",
			additions: 50,
			changedFiles: 3,
			commits: [],
		});
		expect(v.ref).toBe("羅馬書 8:28");
		expect(v.alt?.ref).toBe("Romans 8:28");
	});

	// Runs pickVerseWithLLM with a spy AI binding and returns the exact user
	// content that hit the model — lets us assert prompt structure without
	// reaching into vi mock internals at each call site.
	async function captureUserContent(commits: string[]): Promise<string> {
		const runMock = vi.fn<AiLike["run"]>(async () => ({
			choices: [{ message: { content: bilingualContent } }],
		}));
		await pickVerseWithLLM({ run: runMock }, {
			prTitle: "chore: cleanup",
			prBody: null,
			additions: 5,
			changedFiles: 1,
			commits,
		});
		const callArgs = runMock.mock.calls[0]?.[1] as {
			messages: Array<{ role: string; content: string }>;
		};
		return callArgs.messages.find((m) => m.role === "user")?.content ?? "";
	}

	it("threads commit subjects into the LLM user content as a 'Recent commits:' block", async () => {
		const userContent = await captureUserContent([
			"✨ Add Stripe webhook retry queue",
			"🐛 Fix idempotency key collision on retry",
		]);
		expect(userContent).toContain("Recent commits:");
		expect(userContent).toContain("- ✨ Add Stripe webhook retry queue");
		expect(userContent).toContain("- 🐛 Fix idempotency key collision on retry");
	});

	it("omits the 'Recent commits:' block when no commits are provided", async () => {
		const userContent = await captureUserContent([]);
		expect(userContent).not.toContain("Recent commits:");
	});

	it("falls back to keyword matcher when the model returns invalid JSON", async () => {
		const ai = fakeAi({ choices: [{ message: { content: "not json at all" } }] });
		const v = await pickVerseWithLLM(ai, {
			prTitle: "hotfix: payment timeout",
			prBody: null,
			additions: 5,
			changedFiles: 1,
			commits: [],
		});
		// hotfix keyword path
		expect(v.ref).toBe("阿摩司書 9:11");
	});

	it("falls back to keyword matcher when the AI binding throws", async () => {
		const ai: AiLike = { run: vi.fn(async () => { throw new Error("503"); }) };
		const v = await pickVerseWithLLM(ai, {
			prTitle: "fix: auth bypass",
			prBody: null,
			additions: 5,
			changedFiles: 1,
			commits: [],
		});
		expect(v.ref).toBe("以弗所書 6:11");
	});

	it("falls back when the model re-picks the excluded ref under either language", async () => {
		// excludeRef is the English ref — bilingual exclude-check should still trip.
		const ai = fakeAi({
			choices: [
				{
					message: {
						content: JSON.stringify({
							verse_zh: "總要警醒禱告,免得入了迷惑。",
							ref_zh: "馬太福音 26:41",
							verse_en: "Watch and pray so that you will not fall into temptation.",
							ref_en: "Matthew 26:41",
						}),
					},
				},
			],
		});
		const v = await pickVerseWithLLM(ai, {
			prTitle: "hotfix: regression",
			prBody: null,
			additions: 5,
			changedFiles: 1,
			commits: [],
			excludeRef: "Matthew 26:41",
		});
		expect(v.ref).not.toBe("馬太福音 26:41");
		// Reroll path falls through to keyword matcher; hotfix → 阿摩司書 9:11
		expect(v.ref).toBe("阿摩司書 9:11");
	});

	it("accepts the legacy { response: string } shape", async () => {
		const ai = fakeAi({ response: bilingualContent });
		const v = await pickVerseWithLLM(ai, {
			prTitle: "anything",
			prBody: null,
			additions: 5,
			changedFiles: 1,
			commits: [],
		});
		expect(v.ref).toBe("羅馬書 8:28");
		expect(v.alt?.ref).toBe("Romans 8:28");
	});
});

describe("verseGatewayUrl", () => {
	// Component-based parsing so tests don't break if the URL serializer
	// ever swaps + for %20 (URLSearchParams vs encodeURIComponent) — what
	// we care about is what BibleGateway *receives*, not the byte form.
	function parse(url: string): { base: string; search: string | null; version: string | null } {
		const u = new URL(url);
		return {
			base: u.origin + u.pathname,
			search: u.searchParams.get("search"),
			version: u.searchParams.get("version"),
		};
	}

	it("builds an English KJV URL", () => {
		expect(parse(verseGatewayUrl("Psalm 23:1", "en"))).toEqual({
			base: "https://www.biblegateway.com/passage/",
			search: "Psalm 23:1",
			version: "KJV",
		});
	});

	it("builds a Chinese CUV URL with UTF-8 round-tripping", () => {
		expect(parse(verseGatewayUrl("詩篇 23:1", "zh"))).toEqual({
			base: "https://www.biblegateway.com/passage/",
			search: "詩篇 23:1",
			version: "CUV",
		});
	});

	it("preserves hyphenated verse ranges", () => {
		expect(parse(verseGatewayUrl("James 1:19-20", "en")).search).toBe("James 1:19-20");
	});

	it("handles leading-digit book names", () => {
		expect(parse(verseGatewayUrl("1 Corinthians 13:4", "en")).search).toBe("1 Corinthians 13:4");
	});
});

describe("formatComment", () => {
	it("links a mono Chinese ref to BibleGateway CUV and anchors on the same ref", () => {
		const out = formatComment({ verse: "耶和華是我的牧者", ref: "詩篇 23:1" });
		expect(out).toBe(
			"> 耶和華是我的牧者\n" +
				"> — *[詩篇 23:1](https://www.biblegateway.com/passage/?search=%E8%A9%A9%E7%AF%87+23%3A1&version=CUV)*\n\n" +
				"*— 🙏 PrayRequest*\n" +
				"<!-- prayrequest:ref=詩篇 23:1 -->",
		);
	});

	it("links a mono English ref to BibleGateway KJV (LLM mono-regression path)", () => {
		// If the LLM regresses to mono shape and returns English, the primary
		// slot must route to KJV — not CUV — so we don't render English text
		// under a Chinese-version link.
		const out = formatComment({ verse: "The LORD is my shepherd", ref: "Psalm 23:1" });
		expect(out).toBe(
			"> The LORD is my shepherd\n" +
				"> — *[Psalm 23:1](https://www.biblegateway.com/passage/?search=Psalm+23%3A1&version=KJV)*\n\n" +
				"*— 🙏 PrayRequest*\n" +
				"<!-- prayrequest:ref=Psalm 23:1 -->",
		);
	});

	it("links both refs (CUV + KJV) when alt is present, anchoring on the primary Chinese ref", () => {
		const out = formatComment({
			verse: "耶和華是我的牧者",
			ref: "詩篇 23:1",
			alt: { verse: "The LORD is my shepherd", ref: "Psalm 23:1" },
		});
		expect(out).toBe(
			"> 耶和華是我的牧者\n" +
				"> — *[詩篇 23:1](https://www.biblegateway.com/passage/?search=%E8%A9%A9%E7%AF%87+23%3A1&version=CUV)*\n\n" +
				"> The LORD is my shepherd\n" +
				"> — *[Psalm 23:1](https://www.biblegateway.com/passage/?search=Psalm+23%3A1&version=KJV)*\n\n" +
				"*— 🙏 PrayRequest*\n" +
				"<!-- prayrequest:ref=詩篇 23:1 -->",
		);
	});
});
