import { describe, it, expect } from "vitest";
import { pickVerse, formatComment } from "../src/verse-picker";

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
});

describe("formatComment", () => {
	it("emits the markdown body and a hidden ref anchor", () => {
		const out = formatComment({ verse: "test verse", ref: "Test 1:1" });
		expect(out).toBe(
			"> test verse\n> — *Test 1:1*\n\n*— 🙏 PrayRequest*\n<!-- prayrequest:ref=Test 1:1 -->",
		);
	});
});
