# Privacy Policy

_Last updated: 2026-10-15_

PrayRequest is a GitHub App that comments a Bible verse on pull requests.
This page explains what data it reads, where that data goes, and what it keeps.

## When PrayRequest acts

PrayRequest only does anything when someone explicitly asks for it:

- a pull request is opened (or marked ready for review) with `@prayrequest`
  in its title or description, or
- someone writes `@prayrequest` in a pull request comment.

GitHub delivers other webhook events to the App, but PrayRequest ignores
them. It does not act on pull requests or comments made by bots such as
Dependabot or Renovate.

## What it reads

When it acts, PrayRequest reads the following from GitHub:

- the pull request's title and description (only the first 1,500 characters
  of the description are used)
- the number of added lines and changed files
- the subject lines of the pull request's recent commits
- the text of a comment that mentions `@prayrequest`, only to check whether
  it asks for a verse or a reroll
- on a reroll, the pull request's comments, to find PrayRequest's own
  previous comment and the verse reference in it

It does **not** read your source code, file contents, or diffs. Comment text
is never sent to the language model.

## Where the data goes

To pick a fitting verse, the pull request's title, description, size, and
commit subjects are sent to a large language model:

- **Cloudflare** runs PrayRequest on Cloudflare Workers and routes the model
  request through Cloudflare Workers AI and AI Gateway.
- **Google** (Gemini) receives the request through Cloudflare and returns a
  verse.

Their handling of this data is covered by the
[Cloudflare Privacy Policy](https://www.cloudflare.com/privacypolicy/) and the
[Google Privacy Policy](https://policies.google.com/privacy). If the model
can't be reached or gives an unusable answer, PrayRequest picks a verse from
a built-in list instead.

If you install PrayRequest on a private repository, the pull request titles,
descriptions, and commit subjects of the pull requests it acts on are sent to
these providers.

## What it keeps

PrayRequest has no database of its own.

- **Operational logs.** Cloudflare keeps Worker logs for a limited period set
  by Cloudflare. They record which verse was chosen, the model's reply when it
  cannot be used, and error details. These logs are used only to debug the App.
- **Model request logs.** Cloudflare AI Gateway may log model requests and
  responses, including the pull request text sent to the model, for the
  period set in its configuration.
- **In memory only.** Short-lived GitHub installation tokens are cached in
  memory while the Worker runs, and are never written to storage.

The verse comment PrayRequest posts lives on GitHub like any other comment.
You can delete it at any time.

PrayRequest does not sell data, show ads, or track users.

## Removing PrayRequest

Uninstall the App from your GitHub account or organization settings under
**Applications → Installed GitHub Apps**. PrayRequest then stops receiving
events from your repositories.

## Changes

Changes to this policy are made in this file, and its history is visible in
the repository's commit log.

## Contact

Questions or requests: open an issue at
<https://github.com/williamchong/pray-request/issues>.
