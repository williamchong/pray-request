import { getInstallationToken } from "../github-auth";
import { postComment, getPullRequestCommitsOrEmpty } from "../github-api";
import { pickVerseWithLLM, formatComment } from "../verse-picker";
import { SUMMON_PATTERN } from "../summon";

interface PullRequestEvent {
	action: string;
	pull_request: {
		number: number;
		title: string;
		body: string | null;
		additions: number;
		changed_files: number;
		user: { type: string };
		draft: boolean;
	};
	repository: { name: string; owner: { login: string } };
	installation: { id: number };
}

export async function handlePullRequest(event: PullRequestEvent, env: Env): Promise<void> {
	if (event.action !== "opened" && event.action !== "ready_for_review") return;
	if (event.pull_request.draft && event.action === "opened") return;
	if (event.pull_request.user.type === "Bot") return;

	const summoned =
		SUMMON_PATTERN.test(event.pull_request.title) ||
		SUMMON_PATTERN.test(event.pull_request.body ?? "");
	if (!summoned) return;

	const owner = event.repository.owner.login;
	const repo = event.repository.name;
	const prNumber = event.pull_request.number;

	// Sequential: commits needs the token, the LLM needs commits. Token is
	// cached in github-auth.ts across webhooks for the same installation,
	// so the warm-path hit is just the one commits round-trip (~150-300ms);
	// cold pays ~500-600ms.
	const token = await getInstallationToken(
		env.GITHUB_APP_ID,
		env.GITHUB_APP_PRIVATE_KEY,
		event.installation.id,
	);
	const commits = await getPullRequestCommitsOrEmpty(token, owner, repo, prNumber);
	const verse = await pickVerseWithLLM(env.AI, {
		prTitle: event.pull_request.title,
		prBody: event.pull_request.body,
		additions: event.pull_request.additions,
		changedFiles: event.pull_request.changed_files,
		commits,
	});
	await postComment(token, owner, repo, prNumber, formatComment(verse));
}
