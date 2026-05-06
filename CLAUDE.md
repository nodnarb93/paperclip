# CLAUDE.md — Paperclip local fork

This file is auto-loaded by Claude Code sessions opened in this repo. It captures the *why* behind the unusual layout here and the routines I follow. Read it before suggesting workflow changes.

## Why this fork exists

This is a **private fork** of [paperclipai/paperclip](https://github.com/paperclipai/paperclip). Its only purpose is to let me layer my own patches over upstream releases and build a Docker image from the patched source. I will **never** contribute back to upstream — there are no PRs going to `paperclipai/paperclip` from this repo.

If a session ever drifts toward "let's clean this up and send it upstream," stop. That is not the goal here.

## Remote layout

```
origin    https://github.com/nodnarb93/paperclip.git   (fetch + push)
upstream  https://github.com/paperclipai/paperclip.git (fetch only)
upstream  no_push                                       (push)
```

- **`origin`** = my fork at `nodnarb93/paperclip`. Read and write.
- **`upstream`** = `paperclipai/paperclip`. Fetch-only by convention; the push URL is set to the literal string `no_push`, which means any `git push upstream …` will fail with a hard error rather than silently pushing. This is intentional. **Do not "fix" it.**

## Branch convention

- **`local-main`** is the working branch and the fork's default branch on GitHub. All my patches and the Docker build target this branch.
- It was originally created from the upstream tag `v2026.428.0` and is advanced by merging newer upstream tags into it (see *Pulling a new upstream release* below).
- The fork still has a `master` branch from when GitHub created it — leave it alone, it's not used.

## Routine workflows

### Pulling a new upstream release

When upstream cuts a new release (e.g. `v2026.X.Y`):

```bash
git checkout local-main
git fetch upstream --tags
git merge v2026.X.Y          # merge the tag, NOT a branch
# resolve conflicts in any patched files (see "Conflict resolution" below)
git push origin local-main
```

Then rebuild Docker (see below).

Do **not** rebase `local-main` onto upstream — keep merges so the patch history stays legible.

### Applying a local patch

1. Edit files on `local-main`.
2. `git commit` with a message that names the upstream issue/behavior being patched (e.g. `Patch: fix entry-file display in agent Instructions UI (upstream #2068)`).
3. `git push origin local-main`.
4. Rebuild Docker (see below).

When patching, leave a short comment in the patched file pointing to *why* (upstream issue #, ticket, or short rationale) so future-me / future-Claude can decide whether to keep the patch when upstream changes the surrounding code.

### Rebuilding Docker

The Docker build is wired to **this** source repo via Docker BuildKit's `additional_contexts` feature (named context: `paperclip-src` → `D:/Git Local Repo/paperclip`). The compose project lives in a separate directory.

```powershell
cd "D:\Paperclip - Personal\Docker"
docker compose build --no-cache
docker compose up -d
```

First clean build: ~10–25 minutes (pulls Node base image, runs `pnpm install --frozen-lockfile`, builds ui + plugin-sdk + server, installs claude-code/codex/opencode globally, installs Playwright Chromium with system deps). Subsequent builds reuse the `pnpm install` layer unless `package.json`, `pnpm-lock.yaml`, or any workspace `package.json` changes — those are fast.

If `package.json`/lockfile didn't change, dropping `--no-cache` makes rebuilds even faster.

## Conflict-resolution guidance

When a `git merge v2026.X.Y` produces conflicts:

- **Default: prefer my patched version.** If I went through the trouble of patching it, the patch represents a behavior I want.
- **Exception: if upstream's change is a security fix, correctness fix, or API-shape change** (e.g. function signature changed and my patch no longer calls it correctly), adopt upstream's structure and re-apply the spirit of my patch on top. Don't blindly keep a patch that no longer compiles.
- After resolving, **leave a one-line comment** at the patched site noting *what* was patched and *why*, e.g.:
  ```
  // PATCH(nodnarb93): show actual entry filename instead of "task-prompt-001"; upstream #2068
  ```
  This makes future merges trivial — the comment tells me whether the patch is still relevant.

## Hard rule: never push to upstream

- `git push upstream <anything>` will fail because the push URL is `no_push`. That is by design.
- If a future session ever sees this fail and wants to "fix" the remote URL, that is a bug. Surface it to me; don't repair it.

## Where my Docker config lives

My `docker-compose.yml` and `Dockerfile` live at:

```
D:\Paperclip - Personal\Docker\
```

That directory is intentionally **separate** from this source repo. The Docker build context stays at `D:\Paperclip - Personal\Docker\`, and this repo is exposed to the build as the named additional context `paperclip-src`. The Dockerfile copies source via `COPY --from=paperclip-src . /build` (or similar) inside a multi-stage build.

If I ever ask you to edit the Docker config, the files to touch are over there — not in this repo.

## Active patches

### Patch 1 — Instructions UI: AGENTS.md shows empty for content with HTML-like tags

**Upstream issue**: [paperclipai/paperclip#2068](https://github.com/paperclipai/paperclip/issues/2068) (still OPEN as of v2026.428.0).

**Symptom**: in the agent Instructions tab, the entry file (typically `AGENTS.md`) renders empty with only the `# Agent instructions` placeholder, even though the API returns the file's content correctly. There is also no Save button on the entry file. Non-entry files like `HEARTBEAT.md` work fine.

**Root cause**: MDXEditor's underlying parser silently fails to render markdown that contains HTML-like tags (e.g. `<br>`, `<SomeTag>`, `<!-- -->`) — even with `suppressHtmlProcessing: true`. The contenteditable ends up empty with no console error and no `onError` callback. The existing DOM-emptiness watchdog races with Lexical's async commit and is unreliable for this case. (Verified empirically: replacing `<` and `>` chars with `_` made the same content render correctly; `<` followed by space, `<=`, autolinks like `<https://…>`, and email autolinks `<foo@…>` do not trigger the failure.)

**Fix**: pre-detect the dangerous pattern from the raw markdown via `markdownContainsRichEditorBreakingTag`, and route such content to the existing raw-textarea fallback. The user sees and can edit their full content; only the rich-editing experience is downgraded for files with HTML tags.

**Where**: [ui/src/components/MarkdownEditor.tsx](ui/src/components/MarkdownEditor.tsx) — see the `PATCH(nodnarb93)` comments. Commit `e7f9d86e`.

**Known tradeoffs (deliberate but imperfect — flagged here so future-me doesn't re-litigate)**:

1. **Mid-typing editor swap.** `MarkdownEditor` is reused across issue composers, chat replies, comments, and agent instructions. If a user types `<SomeTag>` from inside the rich editor, the moment they close the angle bracket the regex matches and the editor swaps to the textarea under their cursor. Caveat: without the patch the editor would have gone empty in that same moment, so the swap is arguably less bad than the bug — but it's still a paper cut.
2. **No @mentions or /-slash commands in the fallback.** The textarea has no autocomplete. So if my AGENTS.md has any `<br>`-style content, I can't add `@coder` to it without first stripping the HTML.
3. **No drag-drop image upload in the fallback.** The fallback wrapper doesn't wire up the image-drop handlers that the rich editor branch has.
4. **False positives on harmless content.** The regex matches anything that *looks* like an HTML tag. So a sentence like *"You can use `<p>` tags in HTML"* gets routed to the fallback even though MDXEditor probably would have rendered the literal text fine. We didn't bisect every variant — we only proved `<word>` breaks it.
5. **Blast radius is wider than the bug observed.** We saw the bug in agent Instructions, but the patch lives in shared `MarkdownEditor.tsx`, so every place users type markdown in Paperclip is affected.

**Cleaner fix we did NOT take (worth revisiting if any of the tradeoffs above bite)**: make the existing DOM-emptiness watchdog at `MarkdownEditor.tsx:609` actually work — set `richEditorError` only when MDXEditor *empirically* renders empty, not when content *might* break it. The watchdog has timing races (Lexical's async commit vs. `setTimeout(0)` vs. MutationObserver) that I didn't fully diagnose; the pre-detection approach was provably reliable but trades away the cases where MDXEditor would have rendered HTML-like content fine. If a watchdog-based fix lands, both the regex-match path AND `richEditorError` should still trigger fallback, but the regex check would only be belt-and-suspenders.

**Important context: upstream's tests codify the OPPOSITE design**. Two things that came up during PR-prep research and matter for any future work in this area:

- The test mock at `ui/src/components/MarkdownEditor.test.tsx:70` only simulates the empty-render failure when `suppressHtmlProcessing` is *false*. Paperclip passes `suppressHtmlProcessing: true`, so the mock returns content as-is for HTML-tag input. **The mock is the bug** — it lets a wrong assumption pass tests in CI even though production hits the bug.
- Built on top of that unfaithful mock, the test at `MarkdownEditor.test.tsx:278` is named *"keeps arbitrary HTML-like tags in the rich editor instead of falling back to raw source"* and renders `<section>...<p>Benchmark notes</p></section>` expecting the rich editor to render it. With our patch applied, that test fails. The test at line 302 (*"keeps scriptable pasted HTML inert in the rich editor"*) likely fails too. **Don't run `pnpm test` on this fork expecting green — those two will fail by design.**

These were merged in upstream commit `87f19cd9` (PR #4861, *"Improve issue thread scale and markdown polish"*) authored by Codex GPT-5.5. The PR description claims it "hardened markdown editor behavior around HTML tags," which the failing-on-mock tests appear to vouch for, but in production the hardening doesn't actually trigger for paperclip's `suppressHtmlProcessing: true` config. So the upstream maintainers may not yet realize their tests don't reflect real MDXEditor behavior. If contributing back is ever reconsidered, lead with this finding — it's the most useful thing we know that they don't.

**Conflict-resolution note for future upstream merges**: if upstream changes `MarkdownEditor.tsx`, retain the helper `markdownContainsRichEditorBreakingTag` and the `fallbackForcedByContent` branch. The fix is independent of MDXEditor's own internals — if upstream eventually fixes #2068 at the MDXEditor level (or fixes the mock and watchdog), the regex check becomes a no-op for already-rendering content and we can remove it as a follow-up.

### Patch 2 — `.gitattributes` for LF on `*.sh` and `*.sql`

**Why it exists**: my Windows checkout has `core.autocrlf=true`, which lands `.sh` and `.sql` files in the working tree with CRLF line endings. Two consequences:

1. **Linux refuses to exec shell scripts with `\r` in the shebang** — the entrypoint script in particular crashes the container on first start.
2. **Drizzle hashes the raw bytes of `.sql` migration files.** CRLF changes the hash, so the migration runner sees every previously-applied migration as un-applied and crashes recreating existing tables. (We hit this on a rebuild and had to debug a restart loop — see commit `4d1641bf`.)

**Fix**: [`.gitattributes`](.gitattributes) at the repo root forces LF for `*.sh` and `*.sql`. After committing it, the working tree was renormalized via `git ls-files -z '*.sh' '*.sql' | xargs -0 rm -f && git checkout HEAD -- '*.sh' '*.sql'` so the existing files actually get LF instead of CRLF on disk. Since we COPY from the working tree into Docker (via the `paperclip-src` named context), this means the image gets LF too.

**Where**: [.gitattributes](.gitattributes). Commit `4d1641bf`.

**Conflict-resolution note**: this should never conflict with upstream — they have no `.gitattributes` of their own. If upstream ever adds one, merge ours with theirs (the union of patterns is fine). The Dockerfile's existing `find . -name '*.sh' … sed 's/\r$//'` is now redundant but harmless; leave it as belt-and-suspenders in case I ever check out on a machine without `.gitattributes` honored.

## Notes on upstream's build (so you don't have to re-derive it)

- Package manager: `pnpm@9.15.4` via corepack. Engine: Node `>=20`.
- Build command: `pnpm install --frozen-lockfile` then three filtered builds — `pnpm --filter @paperclipai/ui build`, `pnpm --filter @paperclipai/plugin-sdk build`, `pnpm --filter @paperclipai/server build`. The reference is upstream's root `Dockerfile`.
- Server entrypoint: `scripts/docker-entrypoint.sh`, then `node --import ./server/node_modules/tsx/dist/loader.mjs server/dist/index.js`.
- Default port: `3100`. Default volume: `/paperclip`.

If upstream's `Dockerfile` changes meaningfully across releases, mirror those changes into my Dockerfile in `D:\Paperclip - Personal\Docker\` rather than diverging silently.
