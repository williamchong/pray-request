const API = "https://api.github.com";
const UA = "PrayRequest";

export function ghHeaders(authToken: string, extra?: Record<string, string>): Record<string, string> {
	return {
		Authorization: `Bearer ${authToken}`,
		Accept: "application/vnd.github+json",
		"X-GitHub-Api-Version": "2022-11-28",
		"User-Agent": UA,
		...extra,
	};
}

interface Comment {
	id: number;
	body: string;
	user: { login: string; type: string };
}

export async function postComment(
	installationToken: string,
	owner: string,
	repo: string,
	issueNumber: number,
	body: string,
): Promise<void> {
	const r = await fetch(`${API}/repos/${owner}/${repo}/issues/${issueNumber}/comments`, {
		method: "POST",
		headers: ghHeaders(installationToken, { "Content-Type": "application/json" }),
		body: JSON.stringify({ body }),
	});
	if (!r.ok) throw new Error(`postComment failed: ${r.status} ${await r.text()}`);
}

// GitHub returns issue comments oldest-first with no documented `direction`
// param — so page 1 is the oldest 100. For typical PRs (<100 comments) the
// bot's previous verse is in there; on busier PRs reroll silently picks the
// same verse. Acceptable for v0; revisit with Link-header pagination or
// GraphQL if it becomes a real complaint.
export async function findLastBotComment(
	installationToken: string,
	owner: string,
	repo: string,
	issueNumber: number,
	botLoginPrefix: string,
): Promise<Comment | null> {
	const r = await fetch(
		`${API}/repos/${owner}/${repo}/issues/${issueNumber}/comments?per_page=100`,
		{ headers: ghHeaders(installationToken) },
	);
	if (!r.ok) throw new Error(`listComments failed: ${r.status} ${await r.text()}`);
	const comments = (await r.json()) as Comment[];
	return (
		comments.findLast(
			(c) => c.user.type === "Bot" && c.user.login.startsWith(botLoginPrefix),
		) ?? null
	);
}

interface PullRequest {
	title: string;
	body: string | null;
	additions: number;
	changed_files: number;
	user: { type: string };
}

export async function getPullRequest(
	installationToken: string,
	owner: string,
	repo: string,
	prNumber: number,
): Promise<PullRequest> {
	const r = await fetch(`${API}/repos/${owner}/${repo}/pulls/${prNumber}`, {
		headers: ghHeaders(installationToken),
	});
	if (!r.ok) throw new Error(`getPullRequest failed: ${r.status} ${await r.text()}`);
	return (await r.json()) as PullRequest;
}

export function extractRefFromBody(body: string): string | null {
	const match = body.match(/<!--\s*prayrequest:ref=(.+?)\s*-->/);
	return match ? match[1].trim() : null;
}

interface PullRequestCommit {
	commit: { message: string };
}

// Bounds the per-PR token budget — capped at 10 subjects × 200 chars to keep
// the LLM prompt under ~500 tokens of commit signal even on a busy PR.
const COMMITS_PER_PAGE = 10;
const MAX_SUBJECT_CHARS = 200;
// Commits enrichment is on the critical path before the LLM call, so a hung
// GitHub fetch would silently park the request until the platform kills it.
// 5s is generous for a small list call; failures degrade via OrEmpty below.
const COMMITS_TIMEOUT_MS = 5000;

async function getPullRequestCommits(
	installationToken: string,
	owner: string,
	repo: string,
	prNumber: number,
): Promise<string[]> {
	const r = await fetch(
		`${API}/repos/${owner}/${repo}/pulls/${prNumber}/commits?per_page=${COMMITS_PER_PAGE}`,
		{ headers: ghHeaders(installationToken), signal: AbortSignal.timeout(COMMITS_TIMEOUT_MS) },
	);
	if (!r.ok) throw new Error(`getPullRequestCommits failed: ${r.status} ${await r.text()}`);
	const commits = (await r.json()) as PullRequestCommit[];
	// Take the subject line only (first \n-delimited segment); commit bodies
	// are noise for verse matching and would balloon the prompt. Truncate
	// long subjects to bound token cost on PRs with verbose commit titles.
	return commits.map((c) => c.commit.message.split("\n", 1)[0].slice(0, MAX_SUBJECT_CHARS));
}

// Best-effort wrapper: commits are an optional enrichment signal for the
// verse picker's LLM prompt, not a hard requirement. Network failures,
// timeouts, and unexpected response shapes degrade to "no commit signal"
// (empty array) rather than failing the whole webhook. The console.warn
// surfaces sustained regressions (rate limits, permission changes) in
// Workers logs without affecting the user-visible flow.
export async function getPullRequestCommitsOrEmpty(
	installationToken: string,
	owner: string,
	repo: string,
	prNumber: number,
): Promise<string[]> {
	try {
		return await getPullRequestCommits(installationToken, owner, repo, prNumber);
	} catch (err) {
		console.warn("getPullRequestCommits failed; degrading to no commit signal", err);
		return [];
	}
}
