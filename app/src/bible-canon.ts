// Protestant 66-book canon shared by KJV (English) and 和合本 / CUV
// (Traditional Chinese). Used as a defense-in-depth guard against the LLM
// hallucinating book names or out-of-bounds chapter:verse pairs. BibleGateway
// returns HTTP 200 with a "No results" page for invalid refs, so this is the
// only layer that can pre-reject a bad link before we post it.
//
// Coverage limits:
// - Per-chapter verse counts would need ~1200 entries; we cap globally at
//   176 (Psalm 119, the longest chapter). Catches "Psalm 23:999"-class
//   errors but not chapter-specific overruns.
// - Apocryphal / deuterocanonical books are excluded — KJV (Protestant
//   edition) and CUV are both Protestant; KJV has had Apocrypha removed
//   in standard editions since the 19th century.
// - Book names are Traditional-only; a simplified-Chinese regression would
//   fail validation and fall through to the keyword matcher, which is the
//   intended safe failure.

interface BookEntry {
	zh: ReadonlyArray<string>;
	en: ReadonlyArray<string>;
	chapters: number;
}

// Order is conventional (OT then NT) — order doesn't affect lookup but keeps
// the table scannable. English variants accept the common alternate name
// ("Psalm"/"Psalms"); Chinese is 和合本 (CUV) canonical only.
const BOOKS: ReadonlyArray<BookEntry> = [
	// Old Testament — 39 books
	{ zh: ["創世記"], en: ["Genesis"], chapters: 50 },
	{ zh: ["出埃及記"], en: ["Exodus"], chapters: 40 },
	{ zh: ["利未記"], en: ["Leviticus"], chapters: 27 },
	{ zh: ["民數記"], en: ["Numbers"], chapters: 36 },
	{ zh: ["申命記"], en: ["Deuteronomy"], chapters: 34 },
	{ zh: ["約書亞記"], en: ["Joshua"], chapters: 24 },
	{ zh: ["士師記"], en: ["Judges"], chapters: 21 },
	{ zh: ["路得記"], en: ["Ruth"], chapters: 4 },
	{ zh: ["撒母耳記上"], en: ["1 Samuel"], chapters: 31 },
	{ zh: ["撒母耳記下"], en: ["2 Samuel"], chapters: 24 },
	{ zh: ["列王紀上"], en: ["1 Kings"], chapters: 22 },
	{ zh: ["列王紀下"], en: ["2 Kings"], chapters: 25 },
	{ zh: ["歷代志上"], en: ["1 Chronicles"], chapters: 29 },
	{ zh: ["歷代志下"], en: ["2 Chronicles"], chapters: 36 },
	{ zh: ["以斯拉記"], en: ["Ezra"], chapters: 10 },
	{ zh: ["尼希米記"], en: ["Nehemiah"], chapters: 13 },
	{ zh: ["以斯帖記"], en: ["Esther"], chapters: 10 },
	{ zh: ["約伯記"], en: ["Job"], chapters: 42 },
	{ zh: ["詩篇"], en: ["Psalm", "Psalms"], chapters: 150 },
	{ zh: ["箴言"], en: ["Proverbs"], chapters: 31 },
	{ zh: ["傳道書"], en: ["Ecclesiastes"], chapters: 12 },
	{ zh: ["雅歌"], en: ["Song of Songs", "Song of Solomon"], chapters: 8 },
	{ zh: ["以賽亞書"], en: ["Isaiah"], chapters: 66 },
	{ zh: ["耶利米書"], en: ["Jeremiah"], chapters: 52 },
	{ zh: ["耶利米哀歌"], en: ["Lamentations"], chapters: 5 },
	{ zh: ["以西結書"], en: ["Ezekiel"], chapters: 48 },
	{ zh: ["但以理書"], en: ["Daniel"], chapters: 12 },
	{ zh: ["何西阿書"], en: ["Hosea"], chapters: 14 },
	{ zh: ["約珥書"], en: ["Joel"], chapters: 3 },
	{ zh: ["阿摩司書"], en: ["Amos"], chapters: 9 },
	{ zh: ["俄巴底亞書"], en: ["Obadiah"], chapters: 1 },
	{ zh: ["約拿書"], en: ["Jonah"], chapters: 4 },
	{ zh: ["彌迦書"], en: ["Micah"], chapters: 7 },
	{ zh: ["那鴻書"], en: ["Nahum"], chapters: 3 },
	{ zh: ["哈巴谷書"], en: ["Habakkuk"], chapters: 3 },
	{ zh: ["西番雅書"], en: ["Zephaniah"], chapters: 3 },
	{ zh: ["哈該書"], en: ["Haggai"], chapters: 2 },
	{ zh: ["撒迦利亞書"], en: ["Zechariah"], chapters: 14 },
	{ zh: ["瑪拉基書"], en: ["Malachi"], chapters: 4 },
	// New Testament — 27 books
	{ zh: ["馬太福音"], en: ["Matthew"], chapters: 28 },
	{ zh: ["馬可福音"], en: ["Mark"], chapters: 16 },
	{ zh: ["路加福音"], en: ["Luke"], chapters: 24 },
	{ zh: ["約翰福音"], en: ["John"], chapters: 21 },
	{ zh: ["使徒行傳"], en: ["Acts"], chapters: 28 },
	{ zh: ["羅馬書"], en: ["Romans"], chapters: 16 },
	{ zh: ["哥林多前書"], en: ["1 Corinthians"], chapters: 16 },
	{ zh: ["哥林多後書"], en: ["2 Corinthians"], chapters: 13 },
	{ zh: ["加拉太書"], en: ["Galatians"], chapters: 6 },
	{ zh: ["以弗所書"], en: ["Ephesians"], chapters: 6 },
	{ zh: ["腓立比書"], en: ["Philippians"], chapters: 4 },
	{ zh: ["歌羅西書"], en: ["Colossians"], chapters: 4 },
	{ zh: ["帖撒羅尼迦前書"], en: ["1 Thessalonians"], chapters: 5 },
	{ zh: ["帖撒羅尼迦後書"], en: ["2 Thessalonians"], chapters: 3 },
	{ zh: ["提摩太前書"], en: ["1 Timothy"], chapters: 6 },
	{ zh: ["提摩太後書"], en: ["2 Timothy"], chapters: 4 },
	{ zh: ["提多書"], en: ["Titus"], chapters: 3 },
	{ zh: ["腓利門書"], en: ["Philemon"], chapters: 1 },
	{ zh: ["希伯來書"], en: ["Hebrews"], chapters: 13 },
	{ zh: ["雅各書"], en: ["James"], chapters: 5 },
	{ zh: ["彼得前書"], en: ["1 Peter"], chapters: 5 },
	{ zh: ["彼得後書"], en: ["2 Peter"], chapters: 3 },
	{ zh: ["約翰一書"], en: ["1 John"], chapters: 5 },
	{ zh: ["約翰二書"], en: ["2 John"], chapters: 1 },
	{ zh: ["約翰三書"], en: ["3 John"], chapters: 1 },
	{ zh: ["猶大書"], en: ["Jude"], chapters: 1 },
	{ zh: ["啟示錄"], en: ["Revelation"], chapters: 22 },
];

// Inverse lookup tables built once at isolate startup. English keys are
// lowercased so "PSALM 23:1" / "psalm 23:1" / "Psalm 23:1" all hit.
const BY_ZH = new Map<string, BookEntry>();
const BY_EN = new Map<string, BookEntry>();
for (const book of BOOKS) {
	for (const name of book.zh) BY_ZH.set(name, book);
	for (const name of book.en) BY_EN.set(name.toLowerCase(), book);
}

// Capture: 1=book name (possibly with leading "1 "/"2 "/"3 " and inner
// spaces), 2=chapter, 3=start verse. End-of-range verse is dropped — for
// bilingual consistency we only need start. Char class excludes `\w` so
// digits and `_` can't sneak into the middle of a book name (no real book
// has either, and the leading-digit prefix is the only place we want them).
const REF_PARSE =
	/^((?:[1-3]\s+)?[A-Za-z一-鿿][A-Za-z一-鿿 .'-]+?)\s+(\d{1,3}):(\d{1,3})(?:-\d{1,3})?$/;

// Psalm 119 — the longest chapter — has 176 verses. Anything beyond that
// is hallucination regardless of which book. Per-chapter verse caps would
// need a ~1200-entry table for marginal benefit.
const MAX_VERSE = 176;

export interface ParsedRef {
	book: BookEntry;
	chapter: number;
	verse: number;
	// Which canon map matched the book name — single source of truth for
	// "what language is this ref in" so callers don't re-derive via heuristic
	// regex (avoids drift if BOOKS ever gains romanized Chinese aliases).
	lang: "zh" | "en";
}

function lookupBook(name: string): { book: BookEntry; lang: "zh" | "en" } | null {
	const zh = BY_ZH.get(name);
	if (zh) return { book: zh, lang: "zh" };
	const en = BY_EN.get(name.toLowerCase());
	if (en) return { book: en, lang: "en" };
	return null;
}

export function parseRef(ref: string): ParsedRef | null {
	const m = ref.trim().match(REF_PARSE);
	if (!m) return null;
	const [, name, chapStr, verseStr] = m;
	const found = lookupBook(name);
	if (!found) return null;
	const chapter = Number(chapStr);
	const verse = Number(verseStr);
	if (chapter < 1 || chapter > found.book.chapters) return null;
	if (verse < 1 || verse > MAX_VERSE) return null;
	return { ...found, chapter, verse };
}

// True iff both refs parse and point to the same book + chapter + start
// verse. Used by the bilingual path so a prompt-drifting model that returns
// 詩篇 23:1 paired with an unrelated Matthew 5:1 gets caught before posting.
export function refsAgree(refA: string, refB: string): boolean {
	const a = parseRef(refA);
	const b = parseRef(refB);
	return a !== null && b !== null && a.book === b.book && a.chapter === b.chapter && a.verse === b.verse;
}
