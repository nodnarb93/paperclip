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

## Checkpoints / rollback

Before a non-trivial patch series I tag the current `local-main` HEAD as a rollback anchor. The tags follow the convention `pre-patch-<N>-<short-name>` so it's obvious from `git tag --list 'pre-*'` what state each one represents.

To roll back to a checkpoint if a patch series goes wrong:

```bash
git checkout local-main
git reset --hard pre-patch-<N>-<short-name>
git push origin local-main --force-with-lease     # only if the bad state was already pushed
```

`--force-with-lease` is the safer cousin of `--force` — it refuses to push if someone else (or another machine) advanced the branch in the meantime. Always prefer it over plain `--force`.

Existing checkpoints:

- **`pre-patch-3-voice-input`** → commit `ab5f63f6`. State of `local-main` just before adding Patch 3 (voice input via Whisper). Patches 1 and 2 are applied; whisper-asr-webservice is running in compose and verified working but no Paperclip code touches it yet.
- **`pre-patch-4-voice-undo`** → commit `af5253cb`. State of `local-main` just before adding Patch 4 (undo button for last voice transcription). Patches 1, 2, 3 are applied and verified.
- **`pre-patch-5-tts-readaloud`** → commit `721b42e9`. State of `local-main` just before adding Patch 5 (read-aloud TTS via openedai-speech sidecar). Patches 1–4 are applied.
- **`pre-patch-6-tts-polish`** → commit `54debd75`. State of `local-main` just before adding Patch 6 (TTS modal polish: hide title, settings panel with voice picker + speed pills, server-side markdown stripping). Patches 1–5 are applied and verified working.
- **`pre-patch-7-tts-fixes`** → commit `4dd44a10`. State of `local-main` just before adding Patch 7 (TTS fixes: persistence bug, text normalization expansion, non-blocking floating widget, mobile responsive layout, auto-close on end). Patches 1–6 are applied; known issues from Patch 6 itself: voice/speed didn't persist across modals on same page, TTS mishandled file paths and em-dashes, modal blocked page interaction.
- **`pre-patch-8-kokoro-newissue`** → commit `c5e230d1`. State of `local-main` just before adding Patch 8 (TTS engine swap to Kokoro-FastAPI, Whisper full large-v3, voice input on New Issue dialog). Patches 1–7 applied; known limitations: XTTS robotic cadence, Whisper turbo run-on sentences, voice input only in chat composer.
- **`pre-patch-9-cache-pregen`** → commit `8e003ffc`. State of `local-main` just before adding Patch 9 (LRU audio cache + last-comment pre-gen + cache-size setting). Patches 1–8 (incl. 8.1 fetch fix and 8.2 native voices) applied and verified.
- **`pre-patch-10-tts-polish-2`** → commit `e94768f1`. State of `local-main` just before adding Patch 10 (single-active-modal + visual cached indicator). Patches 1–9 applied; known issues: clicking a second speaker stacked modals and played audio over each other; no way to tell which comments had cached audio.
- **`pre-patch-11-whisper-punctuation`** → commit `ef883c62`. State of `local-main` just before adding Patch 11 (Whisper run-on sentence fix via VAD + initial_prompt). Patches 1–10 applied; known issue: Whisper large-v3 produces no-punctuation run-ons on longer dictations because it autoregressively gets stuck in "no-punctuation mode" on long unsegmented audio.
- **`pre-patch-12-hyphen-tts`** → commit `85e7ddcb`. State of `local-main` just before adding Patch 12 (TTS hyphen-stripping in identifier-like tokens). Patches 1–11 applied; known issue: TTS reads `BIZ-117` as "B I Z minus one one seven" instead of "B I Z one one seven".
- **`pre-patch-13-scroll-bottom`** → commit `0b1aa1fb`. State just before adding Patch 13 (auto-scroll to bottom on issue load + up arrow). Patches 1–12 applied; issue page opens at top, user manually clicks the down arrow every time.
- **`pre-patch-14-voice-icon-bump`** → commit `1c6c7c7a`. State just before Patch 14 (default voice → am_echo + bigger comment speaker icons).
- **`pre-patch-15-sticky-scroll`** → commit `3b396dcc`. State just before Patch 15 (sticky scrollbar that auto-follows new comments when user is at bottom).
- **`pre-patch-16-heading-pause`** → commit `ed1f612f`. State just before Patch 16 (heading punctuation for TTS pauses).
- **`pre-patch-17-tts-pauses`** → commit `5e756956`. State just before Patch 17 (comma after stripped identifier + period after bullet/numbered list items).
- **`pre-patch-18-ui-polish`** → commit `42e47d09`. State just before Patch 18 (radius fix, list alternation, sidebar section delineation, mobile nav active color).
- **`pre-patch-19-manifest-id`** → commit `ab388d1e`. State just before Patch 19 (manifest `id: "/?pwa=paperclip"` for PWA identity uniqueness across multi-app tailnet hosts).
- **`pre-patch-20-comments-width`** → commit `03c1efa9`. State just before Patch 20 (chat-message separators + wider issue-detail content).
- **`pre-patch-21-manifest-path`** → commit `4442463d`. State just before Patch 21 (rename Paperclip manifest to /paperclip.webmanifest — Android Chrome WebAPK keys by normalized_manifest_url, not manifest id, so distinct path is the real requirement).
- **`pre-patch-22-deferred-wake-promote`** → commit `01fd16d0`. State just before Patch 22. Symptom: agent reassigned via PATCH does not wake up; the new assignee's wakeup gets deferred behind a queued run from the prior assignee, and when that prior run is cancelled by the staleness check (`issue_assignee_changed`), the deferred wake is left orphaned indefinitely. Fix: `cancelQueuedRunForStaleIssue` in `server/src/services/heartbeat.ts` now calls `releaseIssueExecutionAndPromote(cancelled)` so deferred wakes for the same issue get promoted within the same transaction window. See the inline `PATCH(nodnarb93): deferred-wake promote on stale-queued cancel (Patch 22)` comment at the patch site for the full diagnosis (witnessed on BIZ-134 / issue id `3e70fdb2-6ed7-4450-a07c-035e5a300d07` on 2026-05-13).
- **`pre-patch-23-tts-letter-digit-space`** → commit `cc9ac4bc`. State just before Patch 23. Symptom: Kokoro pronounces "V1" / "V2" / "GPT4" as glued syllables ("vone", "vtwo") because its tokenizer doesn't see a natural break between the letter and the digit run. Fix: in `normalizeForSpeech` (server/src/routes/audio.ts), insert a space between any letter immediately followed by digits. Not mirrored for digit+letter — ordinals ("2nd"), time markers ("10am"), and resolution shorthand ("4K") read better intact.
- **`pre-patch-24-whisper-vocab`** → commit `121aefbb`. State just before Patch 24. Adds two operator-facing Whisper features and bundles a contraction-friendly initial_prompt rewrite. (a) **Vocabulary biasing**: a JSON file at `${instanceRoot}/whisper-vocab.json` (host path `D:\Paperclip - Personal\Docker\instance\instances\default\whisper-vocab.json`) lists proper nouns / domain terms; on each transcription request, those terms are appended to the Whisper initial_prompt as a natural-sounding sentence, biasing the model to recognize them (fixes the "paperclip" → "pay per click" misrecognition). (b) **Voice-shortcut replacements**: the same JSON file holds `{from, to}` pairs that get applied post-transcription via case-insensitive whole-word regex (e.g. spoken "hashtag" → literal `#`). (c) **Contractions prompt**: the base style prompt was rewritten with contractions ("here's", "I'm", "let's") because the prior fully-expanded prompt was biasing Whisper to expand contractions in user dictations too. File is loaded lazily with mtime caching — edits take effect on the next transcription without container restart. Missing or unparseable file falls back to base prompt + no replacements; never blocks a transcription.
- **`pre-patch-25-agent-instruction-edit`** → commit `5c3c5e24`. State just before Patch 25. Lets meta-agents (specifically those with `permissions.canCreateAgents=true`) edit existing agents' instruction-bundle files via PUT `/api/agents/{id}/instructions-bundle/file`. Implemented as a narrow split of the existing `assertCanManageInstructionsPath` gate: new helper `assertCanWriteInstructionsBundleFile` accepts board OR `canCreateAgents` agents and is wired only to the PUT endpoint. All other instruction-bundle write paths (DELETE, PATCH bundle config / path / mode / entryFile) stay board-only. Companion: new `skills/paperclip-edit-agent/SKILL.md` documents the edit workflow with the explicit hard rule "edit existing files only — no create, no delete, no rename." The Recruiter's HEARTBEAT.md (in `${instanceRoot}/companies/.../agents/{recruiter-id}/instructions/`) was updated separately to point Mode B + D2 at the new skill, add a sanity-check that any file the operator asks to edit already exists in the target's bundle, and clean up D1 (new-hire path) to use `paperclip-create-agent`'s `instructionsBundle.files` inline payload instead of trying to PUT files separately after creation.
- **`pre-patch-26-spa-fallback-and-image-poison`** → commit `d804376c`. State just before Patch 26. Bundles two related fixes that together prevent a chain-of-failure observed on BIZ-158 (issue `cdbab8f0-3162-47e5-8c86-5cc0f5d8d508`) on 2026-05-13. **(a) SPA fallback API-prefix guard** (`server/src/app.ts`): the SPA catch-all route previously returned `200 text/html` for any path that wasn't `/assets/...`, which meant calls to API endpoints missing the `/api` prefix (e.g. `/attachments/<id>/content` instead of `/api/attachments/<id>/content`) silently received the HTML shell. An agent that fetched an "image" via this wrong path then base64-encoded the HTML bytes and saved them into its Claude tool_result history, poisoning the session. New denylist `API_ONLY_PATH_PREFIXES = ["/attachments/", "/heartbeat-runs/", "/audio/", "/llms/"]` — paths under these prefixes return JSON 404 with a hint about the missing `/api` instead of the SPA HTML. **(b) Drop-session-on-image-poison** (`server/src/services/heartbeat.ts`): when a Claude run terminates with `errorMessage` matching `/could not process image/i`, the run-completion path now calls `clearTaskSessions` instead of `upsertTaskSession`, so the next wake for the same task starts a fresh Claude conversation rather than inheriting the poisoned history. The BIZ-158 stuck record was also manually cleared from `agent_task_sessions` during this patch — future occurrences self-recover. Smoke test: any path that should still SPA-fallback (`/`, `/inbox`, `/issues/<id>`, etc.) continues to serve HTML; the four denylisted prefixes now 404 as JSON.
- **`pre-patch-27-stale-run-loop-guard`** → commit `f845f841`. State just before Patch 27. Symptom: between 2026-05-15 01:34 and 05:08, 75 "Review silent active run for Coder" evaluation issues were auto-created in rapid sequence (every 2-3 minutes), all bound to the same `heartbeat_run f3c1dbeb-1d99-4e33-af8b-f5c42c0076df`. Each fresh issue was assigned to the CTO agent, which spawned a Claude run to triage it — burning the daily Claude allowance. Root cause: the active-run output watchdog (`scanSilentActiveRuns` in `server/src/services/recovery/service.ts`) creates a "Review silent active run for <agent>" eval issue whenever a `heartbeat_run` in `status=running` has `last_output_at` older than 1 hour, with dedup enforced by partial unique index `issues_active_stale_run_evaluation_uq` (excludes done/cancelled). The CTO closed each eval as a false positive via the regular issue-update API — which doesn't call `recordWatchdogDecision`, so no row landed in `heartbeat_run_watchdog_decisions`. With the previous eval closed and no snooze recorded, the next scheduler tick re-fired for the same run. Loop. 75 cycles. Fix: in `createOrUpdateStaleRunEvaluation`, before creating a fresh eval, look for the most recent closed eval for the same run; if one exists AND no watchdog decision was ever recorded for the run AND `last_output_at` hasn't advanced past the closure timestamp, treat the closure as a permanent dismiss and return `{kind: "skipped"}`. Two new helpers: `findMostRecentClosedStaleRunEvaluation`, `hasAnyWatchdogDecision` (the latter preserves the existing rearm semantics when an agent actually used `recordWatchdogDecision`). Regression test added in `heartbeat-active-run-output-watchdog.test.ts`.
- **`pre-patch-28-silent-run-auto-cancel`** → commit `9aaeeac7`. State just before Patch 28. Replaces the legacy "create eval issue for human/agent review" silent-run watchdog flow with an end-to-end automated recovery: when a heartbeat run goes silent for `PAPERCLIP_SILENT_RUN_AUTO_CANCEL_AFTER_MS` (default 30 min, floor 1 min), the watchdog (a) cancels just the run via `heartbeat.cancelRun(run.id)` (not the issue), (b) posts an explanatory comment on the source issue with run id, agent + adapter, started-at, last-output-at, silence age, threshold, an 8 KB redacted tail of the run log, and the recovery owner's three action options, (c) reassigns the source issue to the recovery owner (typically CTO) so the existing assignment-triggered wakeup picks it up, and (d) logs `heartbeat.output_stale_auto_cancelled` to the activity log. Loop guard: if the recovery owner would resolve to the silent run's own agent (e.g. CTO's own run is silent), or no eligible recovery owner can be found, the issue is reassigned to the board user with `status=blocked` instead. Toggles: `PAPERCLIP_SILENT_RUN_AUTO_CANCEL_ENABLED` (default true) and `PAPERCLIP_SILENT_RUN_AUTO_CANCEL_AFTER_MS`. Backward compat: legacy `createOrUpdateStaleRunEvaluation` path (with Patch 27's loop guard) is preserved and exercised in the "legacy eval-issue path" describe block. Out of scope: the underlying `reapOrphanedRuns` gap where a `heartbeat_runs` row can stay in `status=running` long after the process has died — this patch bounds the blast radius without fixing it. The 75 already-existing eval issues from 2026-05-15 were hidden out-of-band via `UPDATE issues SET hidden_at = now()`.
- **`pre-patch-29-self-host-issue-urls`** → commit `48fb5210`. State just before Patch 29. Symptom: after upstream merged commit `8145141c` on 2026-04-26 (PR #4558, "Fix external issue URL rewriting in markdown"), clicking an issue identifier inside a comment opened a new tab pointing at `http://localhost:3100/<prefix>/issues/<id>` regardless of the operator's current origin. Upstream's fix unconditionally rejects all absolute http(s) URLs from the issue-reference rewriter — correct in principle, but breaks this fork's single-instance-multiple-origins setup (tailnet hostname + LAN IP + localhost reachable simultaneously). Agents inject `PAPERCLIP_API_URL=http://localhost:3100/api` into their env, so agent-authored comments embed absolute localhost URLs that then become hard-coded localhost click targets for every other operator. Patch: in `ui/src/lib/issue-reference.ts` and `ui/src/lib/mention-chips.ts`, treat absolute http(s) URLs whose hostname is `localhost` / `127.0.0.1` / `0.0.0.0` / `::1` as self-host and strip the origin during rewriting — the rewritten href becomes the relative path `/issues/<id>`, so the browser resolves it against the current `window.location.origin` at click time (SPA navigation in the same tab). Genuine remote-instance URLs (any other hostname, including real remote tailnet hostnames or external Paperclip instances) keep upstream's preserve-as-external behavior. New `SELF_HOST_HOSTNAMES` set + `selfHostIssuePathnameOrNull` helper. If upstream ever adds its own self-host allowlist, drop these and verify the same scenarios still work.
- **`pre-patch-30-productivity-review-killswitch`** → commit `b1aec495`. State just before Patch 30. Symptom: the periodic productivity-review reconciliation (separate from the silent-run watchdog patched in 27/28) had quietly accumulated 2,381 system comments on BIZ-271 and 1,965 on BIZ-273 (~9,600 across 23 ever-created review issues) at the 30s scan tick. Same partial-unique-index loop pattern as the stale-run watchdog: agent closes the eval, system recreates a new one. For this fork's single-user fully-automated setup the feature has no downstream actor that productively closes the loop. Patch: add env-driven kill switch `PAPERCLIP_PRODUCTIVITY_REVIEW_ENABLED` (default true to preserve upstream behavior). When set to `false`, the new `productivityReviewService` dep `enabled: false` short-circuits `reconcileProductivityReviews` at the very top — zeroed result, no candidate query, no eval issues, no refresh comments, no activity-log entries. Wiring is one line in `heartbeatService` that reads the env and forwards it. Operator-side (not in commit): docker-compose adds `PAPERCLIP_PRODUCTIVITY_REVIEW_ENABLED=false` to the personal service env, and the 23 existing `issue_productivity_review` issues were hidden out-of-band so the UI is clean.
- **`pre-patch-31-claude-local-env-sanitize`** → commit `2de822ad`. State just before Patch 31. Symptom: agent child processes spawned by the `claude_local` adapter inherited `NODE_ENV` (and other Node/npm toolchain env vars) from the Paperclip server's `process.env`. When `NODE_ENV=production` is set on the server, the inherited value caused `npm install` inside an agent workspace to skip `devDependencies` — breaking Playwright and any other devDep-bound tool for downstream agents like a QA Tester. Two-layer fix: (a) extend `sanitizeInheritedPaperclipEnv` (`packages/adapter-utils/src/server-utils.ts`) to also strip `NODE_ENV`, `NODE_OPTIONS`, and any `/^npm_config_/i` key (covers both lowercase `npm_config_*` and uppercase `NPM_CONFIG_*`); the `PAPERCLIP_*` allowlist logic is untouched. (b) Route the `claude_local` adapter's env construction through the sanitizer (`packages/adapters/claude-local/src/server/execute.ts`): replace both raw `{ ...process.env, ...env }` spreads with `{ ...sanitizeInheritedPaperclipEnv(process.env), ...env }`. `plugin-worker-manager.ts` already uses an explicit allowlist (no `process.env` spread); no change needed there. Tests cover the extended strip list and the surviving keys (`PATH`, `HOME`, `LANG`, `PAPERCLIP_RUNTIME_API_URL`). Conflict-resolution note: if upstream adds their own Node-toolchain strip logic, drop the extension and re-verify the same scenarios.

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

### Patch 3 — Voice input via local Whisper (mic button in chat composer)

**Upstream issue**: [paperclipai/paperclip#3907](https://github.com/paperclipai/paperclip/issues/3907) — "Command by voice." Triaged by upstream as out of V1 scope (plugin or browser extension territory). I built it into core because the existing plugin SDK has no extension slot inside the chat composer toolbar, so a plugin can't reach where the mic button needs to live.

**What it does**: adds a mic button in the IssueChatThread composer toolbar (next to the existing attach/paperclip button). Click → records mic audio via `MediaRecorder`. Click again → sends the audio blob to a new `POST /api/audio/transcribe` endpoint, which forwards to a sidecar `whisper-asr-webservice` container (faster_whisper engine, GPU-enabled, `large-v3-turbo` model). The transcript is appended to the composer's existing draft body. Works from desktop and from Android Chrome over HTTP when the Paperclip URL is whitelisted in `chrome://flags/#unsafely-treat-insecure-origin-as-secure` (verified end-to-end on Samsung Galaxy S22+ → 4070 Ti Super → `large-v3-turbo`).

**Where**:

- **Server**:
  - [server/src/config.ts](server/src/config.ts) — added `whisperServiceUrl` (env: `PAPERCLIP_WHISPER_URL`, default `http://whisper:9000`).
  - [server/src/routes/audio.ts](server/src/routes/audio.ts) — new file. `POST /audio/transcribe` accepts a multipart `audio` field, forwards to `${whisperServiceUrl}/asr?encode=true&task=transcribe&output=json`, returns `{ transcript }`. Auth required via `assertAuthenticated`. 50 MB upload cap.
  - [server/src/app.ts](server/src/app.ts) — imports `audioRoutes`, adds `whisperServiceUrl` to `createApp` opts, mounts route under `/api`.
  - [server/src/index.ts](server/src/index.ts) — passes `config.whisperServiceUrl` into `createApp`.
- **UI**:
  - [ui/src/api/audio.ts](ui/src/api/audio.ts) — new file. Thin wrapper around `api.postForm` for `/audio/transcribe`. Re-buffers the blob into a fresh `File` to mirror the `assets.ts` clipboard-paste fix (avoids `ERR_ACCESS_DENIED` from transient MediaRecorder blobs).
  - [ui/src/components/IssueChatThread.tsx](ui/src/components/IssueChatThread.tsx) — adds `Mic`/`Square`/`Loader2` icons + the mic toggle button; adds `isRecording` / `transcribing` / `showTranscribingSpinner` state and `mediaRecorderRef` / `mediaStreamRef` / `audioChunksRef` refs; adds `startVoiceRecording` / `stopVoiceRecording` / `toggleVoiceRecording` / `transcribeAndInsert`; adds `useEffect` cleanup that stops the recorder + mic tracks on unmount. The composer's existing button-row was restructured so the left cluster always renders (the attach button stays conditional on `onImageUpload || onAttachImage`; the mic button is unconditional).
- **Docker**: the `whisper` service is defined in `D:\Paperclip - Personal\Docker\docker-compose.yml` (not this repo). Image: `onerahmet/openai-whisper-asr-webservice:latest-gpu`. `ASR_MODEL=large-v3-turbo`, `ASR_ENGINE=faster_whisper`, GPU reservation via `deploy.resources.reservations.devices`. Model cache lives in named volume `whisper-models`. No host port mapping in production — internal-only on the default Docker network.

All edits in this repo are tagged with `// PATCH(nodnarb93): voice-input (Patch 3)` comments at insertion sites for ease of future merges.

**Commits**: main patch `3edbc1ee`. Follow-up TS fix `3e593062` (wrap multer Buffer in Uint8Array for `BlobPart` compatibility with current `@types/node` — DOM `Blob` constructor's `BlobPart` requires concretely-typed `ArrayBuffer`, not Node's `ArrayBufferLike` generic. Apply the same fix in any future place we feed a multer Buffer to a Web-API constructor.)

### Patch 4 — Undo button for last voice transcription

**Why it exists**: dictating into the composer occasionally produces unwanted output — phantom "Thank you" hallucinations from silent input, accidental recordings, or simply realizing mid-stream that you want to start over. Pre-Patch-4 the only recovery was long-press → select → delete, which is annoying on mobile especially.

**What it does**: after a transcription lands in the composer body, a back-arrow icon (`Undo2`) appears just to the right of the mic button. Clicking it reverts the body to the exact state it was in immediately before the most recent transcription was appended. Auto-hides when the user manually edits the body (signaling they've moved on from "fix the last transcription" mode) or when a new recording starts.

**Key invariants**:

- Undo only ever rolls back **the most recent transcription**, never further. Each new transcription overwrites the previous undo target.
- Undo does **not** delete other content. If you had typed text + done two transcriptions, then click undo, only the second transcription is removed; your typed text and first transcription stay.
- Undo is single-use. After clicking it, the state clears — there's no redo, and no "undo the undo." If you change your mind, just dictate again.

**Where**: [ui/src/components/IssueChatThread.tsx](ui/src/components/IssueChatThread.tsx). Adds `Undo2` to lucide imports, `pendingUndo` state (the `{before, after}` snapshot pair), capture inside `transcribeAndInsert`, clear-on-manual-edit wired into MarkdownEditor's `onChange`, clear-on-new-recording wired into `startVoiceRecording`, and the conditional button JSX in the composer toolbar.

All edits in this repo are tagged with `// PATCH(nodnarb93): voice-undo (Patch 4)` comments at insertion sites.

**Commits**: `f81af3f4`.

**Tradeoffs / decisions explicitly made**:

1. **Auto-dismiss on first manual edit, not on first keystroke.** The check compares the new body value against `pendingUndo.after`. If a user types something that happens to land on the exact same string (e.g., deletes a char and retypes it), undo would stay available — that's fine, it'd produce a correct result. The check is structural, not eventful.
2. **No keyboard shortcut.** Could add `Cmd/Ctrl+Z` for the same effect, but that would collide with the editor's native undo. Better to keep them separate: editor's native undo for typed text, our button for voice insertions.
3. **No undo history beyond depth-1.** Each transcription overwrites the prior snapshot. A history stack was considered and rejected as overkill — mental model "undo last voice insertion" is far simpler than "undo Nth voice insertion in reverse order" and covers the actual use case.

**Conflict-resolution note**: this patch only modifies `IssueChatThread.tsx`. If upstream restructures that file or extracts the composer into a smaller component, port the four touchpoints (state declaration, `transcribeAndInsert` snapshot capture, `MarkdownEditor` onChange wrapping, JSX button) — each tagged with `PATCH(nodnarb93): voice-undo` for easy find.

### Patch 5 — Read-aloud TTS for issue descriptions and chat messages

**Upstream issue**: none. Voluntary feature add.

**What it does**: a small speaker icon button (`Volume2` from lucide) appears next to the issue title (reads only the description) and next to each comment's author name in the chat thread (reads only that comment, user or assistant). Click → modal opens → backend POSTs text to the openedai-speech sidecar → audio streams back as MP3 → blob URL → `<audio>` element auto-plays. Modal has standard player controls: play/pause, restart, ±10s skip, scrubbable progress bar, elapsed/total time display. Closing the modal aborts in-flight synthesis (the server's `res.on("close")` handler propagates the abort to the upstream TTS request via `AbortController`, so we don't burn GPU cycles on audio nobody's listening to).

**Where**:

- **Server**:
  - [server/src/config.ts](server/src/config.ts) — adds `ttsServiceUrl` (env: `PAPERCLIP_TTS_URL`, default `http://tts:8000`).
  - [server/src/routes/audio.ts](server/src/routes/audio.ts) — adds `POST /audio/synthesize`. Auth-gated. Takes JSON `{ text, voice? }`, forwards to `${ttsServiceUrl}/v1/audio/speech` (OpenAI-compatible shape), streams the response body to the client. Aborts upstream on client disconnect. 50000-char text cap.
  - [server/src/app.ts](server/src/app.ts), [server/src/index.ts](server/src/index.ts) — wire `ttsServiceUrl` through `createApp` opts.
- **UI**:
  - [ui/src/api/audio.ts](ui/src/api/audio.ts) — adds `audioApi.synthesize(text, signal)` that fetches the blob (direct `fetch` not via `api.post` because we need a `Blob`, not JSON).
  - [ui/src/components/TtsPlayerModal.tsx](ui/src/components/TtsPlayerModal.tsx) — new file. Modal that handles the synthesis request, manages the `<audio>` element, exposes player controls, and cleans up (pauses playback, revokes blob URL, aborts in-flight synthesis) on close.
  - [ui/src/components/TtsButton.tsx](ui/src/components/TtsButton.tsx) — new file. Tiny wrapper component: `<Button><Volume2 /></Button>` + the modal. Returns `null` for empty text so callers don't have to gate the render.
  - [ui/src/pages/IssueDetail.tsx](ui/src/pages/IssueDetail.tsx) — adds the TTS button next to the issue title in a flex row. Reads only the issue description, not comments.
  - [ui/src/components/IssueChatThread.tsx](ui/src/components/IssueChatThread.tsx) — adds the TTS button to both `IssueChatUserMessage` and `IssueChatAssistantMessage` header rows (next to author name + Follow-up badge). Reuses the existing `getThreadMessageCopyText` helper to extract only text parts (skips reasoning/tool-call parts). Hidden during `isRunning` (don't TTS a stream-in-progress); skipped entirely in the foldable chain-of-thought variant.
- **Docker**: the `tts` service is defined in `D:\Paperclip - Personal\Docker\docker-compose.yml` (not this repo). Recommended image: `ghcr.io/matatonic/openedai-speech` (GPU variant). See the compose snippet at the end of the Patch 5 commit's PR/issue notes.

All edits in this repo are tagged with `// PATCH(nodnarb93): tts-readaloud (Patch 5)` comments at insertion sites.

**Commits**: `b9d845f6`.

**UX details**:

- **Auto-play on synthesis completion.** Some mobile browsers may block this; in that case the user clicks the play button manually. We don't surface a "click play" hint because the controls are obviously visible and the case is rare.
- **No "currently playing" indicator on the launcher button.** The modal is the source of truth for playback state. Closing the modal stops playback.
- **No download / save-audio button.** Considered and skipped — out of scope for "read aloud," and would require keeping the blob URL alive past modal close (memory concerns).
- **Progress bar is scrubbable** (click to seek). No drag handle — click-to-seek is good enough for short audio.

**Known tradeoffs / decisions explicitly made**:

1. **Server-side streaming, client-side buffer-then-play.** Backend pipes upstream → response in chunks (efficient, lets openedai-speech start generating before the full text is "ready"). Client uses `await response.blob()` which waits for the full body before playback starts. *True* streaming playback on the client (audio plays while still downloading) would require `MediaSource` API + codec hints + edge-case handling — easily doubles the component complexity. For typical comment lengths the wait is 2-5 seconds; acceptable. If a comment is so long that the wait becomes annoying, we'd revisit with MediaSource.
2. **Markdown sent verbatim to TTS.** No stripping of asterisks, backticks, links, etc. Modern TTS engines handle markdown OK (they mostly ignore the symbols as pauses). Stripping would also strip useful semantic information (e.g., quoted speech in italics). If a particular markdown construct sounds bad, we can revisit per-case.
3. **No voice selection UI.** Hardcoded to `voice: "alloy"` (openedai-speech default mapping). Adding a voice picker would require either a settings page or a dropdown in the modal — out of scope for v1. Change via the route handler if you want a different default.
4. **No caching.** Every click regenerates audio. Pre-generating + storing per comment was considered and rejected — comments edit, storage would grow unbounded, re-listening to the same comment is rare. On-demand is fine for single-user use.
5. **No TTS button on system messages** (status changes, queue notices, etc.) or on the foldable chain-of-thought variant of `IssueChatAssistantMessage`. Both are intentional — short status text doesn't benefit, and CoT blocks aren't worth narrating (they're often code-heavy or contain tool-call JSON).
6. **TTS button is `icon-xs` on comments, `icon-sm` on the issue title.** Slightly smaller in comment headers to match the more compact row.

**Conflict-resolution note for future upstream merges**:

- `TtsPlayerModal.tsx` and `TtsButton.tsx` are new files unique to this fork — they will never conflict with upstream.
- If upstream changes `IssueDetail.tsx` around the title/description region (~line 3128 in v2026.428.0), find the new InlineEditor pair and re-wrap the title in the `flex items-start gap-2` div with the `TtsButton` alongside.
- If upstream restructures `IssueChatUserMessage` or `IssueChatAssistantMessage`, the TTS button is a one-line `<TtsButton text={getThreadMessageCopyText(message)} />` insertion in each header row. Look for the existing Follow-up badge as the anchor.
- If upstream adds their own TTS / read-aloud feature in core, this patch becomes redundant — delete the patch sites (search for `PATCH(nodnarb93): tts-readaloud`) and either remove the new files or keep them as a fallback implementation.
- `audioRoutes()`'s opts shape gains `ttsServiceUrl`. Same pattern as `whisperServiceUrl` from Patch 3; if upstream changes the route registration shape, both can be migrated together.

**Compose service required (lives in `D:\Paperclip - Personal\Docker\docker-compose.yml`)**:

```yaml
  tts:
    image: ghcr.io/matatonic/openedai-speech:latest
    container_name: paperclip-tts-personal
    restart: always
    environment:
      - TZ=America/Phoenix
    volumes:
      - tts-models:/app/voices
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]
```

And add `tts-models:` to the named volumes block at the bottom. No `ports` mapping — internal-only on the Docker network at `http://tts:8000`, which is what `PAPERCLIP_TTS_URL`'s default points at.

### Patch 6 — TTS modal polish: markdown stripping + voice picker + speed controls

**Why it exists**: Patch 5 shipped a working TTS modal but with three usability issues: (a) the prominent "Read description aloud" header was visually heavy and unnecessary, (b) no way to change the synthesized voice — default `alloy` was high-pitched/grating, (c) no playback speed control, and (d) the TTS engine read markdown punctuation literally ("hash hash heading" instead of skipping the syntax).

**What it does**:

- **Server-side markdown stripping** in `/api/audio/synthesize`: a `stripMarkdownForTts()` function pre-processes the text before forwarding to openedai-speech. Handles headings, bold/italic, inline code, fenced code blocks (replaced with " (code block omitted) " — code-as-speech is universally awful), images, links, bullet/numbered lists, blockquotes, horizontal rules, and stray HTML tags. Single ~25-line regex function, no new npm deps. Identifier-safe (snake_case underscores aren't treated as italic markers).
- **Hidden modal header**: `DialogTitle` is kept in the tree for accessibility (radix Dialog warns otherwise — screen readers still get it) but wrapped in `sr-only` so it's invisible to sighted users. Modal becomes a clean audio-player widget.
- **Settings panel** behind a gear icon in the player controls row. Click → an inline panel expands below the controls (no nested modal — same Dialog, just toggleable content). Click again → collapses. Panel rotates the gear icon 45° to indicate state.
- **Voice picker**: dropdown in the settings panel with all six openedai-speech voices (alloy, echo, fable, onyx, nova, shimmer) labeled with descriptions. Changing voice re-triggers synthesis with the new voice. Persists to localStorage (`paperclip.tts.voice`).
- **Speed control**: pill row in the settings panel with values `0.75x / 1x / 1.25x / 1.5x / 1.75x / 2x`. Active value highlighted. Changes apply instantly via `audio.playbackRate` — *client-side* speed adjustment, no re-synthesis required. `audio.preservesPitch = true` keeps voices from going chipmunk at high speeds. Persists to localStorage (`paperclip.tts.speed`).

**Where**:

- **Server**:
  - [server/src/routes/audio.ts](server/src/routes/audio.ts) — adds `stripMarkdownForTts()` helper; the `synthesize` route now passes user input through it before forwarding to the TTS sidecar. Returns 400 if the post-strip text is empty.
- **UI**:
  - [ui/src/api/audio.ts](ui/src/api/audio.ts) — `audioApi.synthesize` signature changed: 2nd arg is now `{ voice?, signal? }` instead of bare `AbortSignal`. Voice is forwarded in the request body if provided.
  - [ui/src/components/TtsPlayerModal.tsx](ui/src/components/TtsPlayerModal.tsx) — substantially rewritten: hidden title (sr-only), settings gear, expandable panel with voice + speed controls, localStorage persistence helpers, playbackRate sync, voice change triggers re-synthesis. Voice and speed default to localStorage values on mount.

All edits in this repo are tagged with `// PATCH(nodnarb93): tts-polish (Patch 6)` comments at insertion sites.

**Commits**: `94a26f8c`.

**Tradeoffs / decisions explicitly made**:

1. **Markdown stripping is in-house, not a library.** `remove-markdown` and similar npm packages exist but are ~20 KB once you account for transitive deps, and our regex covers the constructs that actually appear in Paperclip's issue descriptions and chat messages. If a real-world edge case isn't handled, swap to a library — but don't preemptively add a dep.
2. **Voice change re-synthesizes audio.** It has to — openedai-speech doesn't offer a "re-voice existing audio" API. There's a brief loading state. Acceptable tradeoff because voice is changed rarely (once, usually, the first time the user finds a voice they like).
3. **Speed is client-side (`playbackRate`), not server-side (`speed` param to TTS).** Even though openedai-speech accepts a `speed` parameter, using it would mean re-synthesizing for every speed change — wasteful and slow. Client-side `playbackRate` is instant and free; `preservesPitch` ensures it sounds natural. The downside is very minor: at 2x the audio is the same duration of *synthesis* but plays in half the time. We don't surface the `speed` server param at all.
4. **Settings panel is inline-expand, not a separate modal or popover.** Keeps both player and settings visible simultaneously when expanded. Lets users adjust speed mid-playback and immediately hear the result.
5. **Six voices, hardcoded list.** openedai-speech's voice list is stable (mirrors OpenAI's). If someone deploys with a non-standard backend that supports more voices, they'd hardcode-edit `VOICE_OPTIONS`. Not worth a config endpoint for single-user use.
6. **localStorage persistence, not server-side user prefs.** Simpler, no API or DB changes. Per-browser, per-device — but that's actually fine: I might want a different default voice on phone vs. desktop, and localStorage gives that for free.
7. **No per-comment voice override.** Considered; rejected. Adds UI complexity for marginal value.

**Conflict-resolution note for future upstream merges**:

- This patch only modifies files added or already modified in Patch 5. Existing patches' files are untouched.
- The markdown stripper is a pure function — easy to keep across merges. If upstream ever ships a similar helper, switch over to theirs.
- The settings panel UI lives entirely inside `TtsPlayerModal.tsx` (a file unique to this fork). Will never conflict with upstream.
- The `voice` field on `/api/audio/synthesize` is forward-compatible: passing it is optional, default fallback is `alloy`. If upstream ever adds their own TTS feature, the API shape is unlikely to conflict.

### Patch 7 — TTS UX fixes: persistence, text normalization, non-blocking widget, auto-close

**Why it exists**: in real use after Patch 6, four problems surfaced:

1. **Voice/speed settings didn't persist** between modals on the same page. The cause: each TtsButton renders its own TtsPlayerModal instance, and `useState(() => readStoredVoice())` runs once at mount (page load). Changing voice in modal A updates localStorage but doesn't propagate to already-mounted modals B/C/D — they're stuck with their stale snapshot.
2. **TTS mishandled common technical content** — em-dashes were skipped without pauses, file paths were spoken as one long syllable salad, abbreviations like `e.g.` got spelled letter-by-letter, decorative unicode (✅ ✓ →) caused weird artifacts.
3. **Modal was modal**: clicking the page closed it, the backdrop blocked interaction. Couldn't read the comment while listening to it.
4. **No auto-close on end**: after audio finished, the widget just sat there. User had to manually click X every time.

**What it does**:

- **Persistence fix via fresh-mount**: `TtsPlayerModal` now returns `null` when `open=false` and renders the inner `TtsPlayer` only when open. The inner component's `useState` initializers run on every mount, picking up the latest localStorage values. No useEffect or pub/sub needed — React's mount/unmount lifecycle does the work.
- **Default voice → `fable`** (British male — user feedback that `alloy` was harsh).
- **Text normalization** in `normalizeForSpeech()` on the server, applied after markdown stripping:
  - Em-dash, en-dash, double-hyphen → comma (forces prosodic pause)
  - File paths and URLs (multi-segment slash patterns) → slash replaced with comma-space, so each segment is spoken with a natural pause
  - Branch-name-like tokens (`feat/BIZ-foo`) → same slash-to-comma
  - Tilde + number → "approximately"
  - Common abbreviations: `e.g.`, `i.e.`, `etc.`, `vs.`, `a.k.a.`, `w/`, `w/o` → expanded
  - Symbols: `&` → "and", `N%` → "N percent"
  - Multiple dots `...` → `…` (renders as longer pause)
  - Decorative unicode (`✅ ✗ → • 🎉` etc.) stripped or replaced with comma
  - Cleanup pass collapses runs of commas/whitespace from the above
- **Non-blocking floating widget**: replaced radix Dialog with a custom fixed-position `<div role="region" aria-label=…>`. No backdrop, no focus trap, no scroll lock, doesn't close on outside click. Z-50 so it floats above content but below toasts. The page underneath is fully interactive.
- **Mobile-responsive layout** via Tailwind responsive prefixes (`md:`):
  - **Desktop (≥768px)**: bottom-right, 24rem wide, full layout with explicit progress bar above the controls row.
  - **Mobile (<768px)**: top-anchored, edge-to-edge (with small inset), single-row controls (`⏮ ↻ ▶ ↺ time ⚙ X`), no explicit progress bar. Instead the **widget's background gradient** fills left-to-right as audio plays — `bg-primary/10` swatch growing with `progressFraction`. Saves vertical screen real estate on mobile while still showing position visually.
- **Auto-close on end**: `onEnded` schedules a 1.5s timer that calls `onClose`. The timer is cancelled by any user interaction (play/pause/seek/restart/skip) so an explicit "wait, I want to hear that again" gesture keeps the widget open. Critically `onEnded` only fires on natural completion, not on user pause — so pausing keeps the widget around.

**Where**:

- **Server**:
  - [server/src/routes/audio.ts](server/src/routes/audio.ts) — `stripMarkdownForTts` now composes `stripMarkdown()` + `normalizeForSpeech()`. The normalization function is ~50 lines of commented regex with each rule citing the failure mode it addresses.
- **UI**:
  - [ui/src/components/TtsPlayerModal.tsx](ui/src/components/TtsPlayerModal.tsx) — rewritten. `TtsPlayerModal` is now a tiny shell that returns `null` when closed and mounts an inner `TtsPlayer` (the real component) when open. `TtsPlayer` is a fixed-position floating widget, mobile-responsive. File name still says "Modal" for backward-compat with existing imports; it's a misnomer now but renaming was deferred to avoid diff churn.

All edits in this repo are tagged with `// PATCH(nodnarb93): tts-fixes (Patch 7)` comments at insertion sites. Earlier patch comments (Patch 5, Patch 6) are preserved for files they originally touched.

**Commits**: `cbf4f260`.

**Tradeoffs / decisions explicitly made**:

1. **Fresh-mount-on-open over global state store.** Could have used `useSyncExternalStore` or a Zustand store for "truly shared" settings across all modals simultaneously. But the only failure mode for fresh-mount is "two modals open at exactly the same time with different settings" — which doesn't happen because the user opens one at a time. Fresh-mount is simpler code with the same UX outcome.
2. **Mobile breakpoint at `md` (768px).** Default Tailwind. If your phone is portrait it gets mobile; landscape iPad gets desktop. Adjust by changing `md:` to `lg:` if that's wrong, but 768px is the standard.
3. **Background-gradient progress on mobile is decorative, not interactive.** Tapping it doesn't seek (the seek handler is only on the desktop progress bar). Reasoning: mobile has limited horizontal real estate, accidentally tapping a thin progress bar to "seek to 87%" is more annoying than valuable. ±10s buttons cover the actual seek use case.
4. **Auto-close at 1.5s after end.** Not 0s (jarring), not 3s (sits awkwardly). 1.5s felt right in mental simulation; adjustable via `AUTO_CLOSE_DELAY_MS` constant if needed.
5. **Symbols stripped, not transliterated to words.** `✅` becomes a comma-pause, not "checkmark." Reading "checkmark" inline is more distracting than the brief pause. Tradeoff is some semantic information loss (a list of items marked with ✅ now has its check-ness erased) — acceptable for read-aloud purposes.
6. **`@` not normalized**. Email addresses contain `@`. Most TTS engines read `foo@bar.com` reasonably ("foo at bar dot com"). Stripping or replacing would break that.
7. **CSS class strings not detected/replaced.** Hard to do without false positives on normal hyphenated phrases. If a real-world example continues to be a problem, we'd add detection — but cost/benefit doesn't justify it preemptively.

**Conflict-resolution note for future upstream merges**:

- Patch 7 only modifies files modified or added by Patches 5/6. No upstream collision surface.
- The radix Dialog replacement in `TtsPlayerModal.tsx` is structurally simple — a fixed-position div with Tailwind classes. If upstream ever adds a similar floating widget elsewhere, look at theirs for styling consistency.
- `normalizeForSpeech()` is a pure function with no external dependencies. Easy to merge across upstream changes; just keep the function and call site intact.

### Patch 8 — Kokoro TTS engine + Whisper large-v3 + voice input on New Issue

**Why it exists**: three user-driven issues after Patch 7 testing:

1. **TTS cadence was robotic** (XTTS via openedai-speech). Per January 2026 research, Kokoro-82M now sits at #1 on the TTS Arena leaderboard, beating XTTS despite being 6× smaller. Worth swapping.
2. **Whisper transcripts had run-on sentences.** large-v3-turbo trades 32→4 decoder layers for 5× speed; the "minor quality degradation" the model card hints at shows up specifically in sentence segmentation and punctuation. Full large-v3 has the full decoder and produces better-segmented text. On a 4070 Ti Super (16 GB VRAM), the extra ~3 GB for the full model is trivial.
3. **Voice input only worked in chat composer.** Should be available everywhere a markdown composer exists. First additional surface: the New Issue dialog.

**What it does**:

- **TTS engine swap**: `openedai-speech` (XTTS) replaced by `Kokoro-FastAPI` (Kokoro-82M). Same OpenAI-compatible API endpoint (`/v1/audio/speech`), so zero Paperclip code changes for the swap itself — only `PAPERCLIP_TTS_URL` changes (Kokoro listens on port `8880` instead of `8000`). Voice names (alloy/echo/fable/onyx/nova/shimmer) pass through Kokoro's OpenAI compat layer and route to its native voicepacks. Existing localStorage voice preferences continue to work.
- **Whisper model**: `ASR_MODEL=large-v3` instead of `large-v3-turbo`. ~3 GB extra VRAM for noticeably better sentence segmentation/punctuation. faster_whisper's CTranslate2 still runs near-real-time on GPU.
- **Voice-input extraction**: the inline voice-input logic in `IssueChatThread.tsx` (state, refs, `startVoiceRecording` / `stopVoiceRecording` / `toggleVoiceRecording` / `transcribeAndInsert` functions, MediaRecorder cleanup useEffect) was extracted into a reusable `useVoiceInput` hook. The mic/undo/spinner button cluster was extracted into a `VoiceInputControls` component. IssueChatThread now uses both with a 2-line integration. The shared logic is now ~150 lines instead of duplicated per consumer.
- **Voice input added to New Issue dialog** via the new hook + component. Sits next to the existing Upload (paperclip) button in the metadata chip row. Description state is fed via the hook's `setDescription` binding; the dialog's existing keystroke-optimized `handleDescriptionChange` callback gets `voice.clearUndoOnEdit(next)` appended so the undo lifecycle works without forcing parent re-renders on every keystroke.

**Where**:

- **UI new files**:
  - [ui/src/hooks/useVoiceInput.ts](ui/src/hooks/useVoiceInput.ts) — the extracted hook. Returns `{ isRecording, transcribing, showTranscribingSpinner, canUndo, toggleRecording, undo, onComposerChange, clearUndoOnEdit }`. `onComposerChange` is the all-in-one (calls setBody + clears undo); `clearUndoOnEdit` is the lightweight variant for consumers like NewIssueDialog that don't want parent setState on every keystroke.
  - [ui/src/components/VoiceInputControls.tsx](ui/src/components/VoiceInputControls.tsx) — the reusable button cluster (mic toggle + undo + deferred spinner).
- **UI modified**:
  - [ui/src/components/IssueChatThread.tsx](ui/src/components/IssueChatThread.tsx) — removed ~150 lines of inline voice logic (state, refs, functions, useEffect), replaced with `const voice = useVoiceInput(setBody)` and `<VoiceInputControls voice={voice} />`. `MarkdownEditor`'s onChange now points at `voice.onComposerChange`. Behavior is functionally identical.
  - [ui/src/components/NewIssueDialog.tsx](ui/src/components/NewIssueDialog.tsx) — added `const voice = useVoiceInput(setDescription)`, appended `voice.clearUndoOnEdit(nextDescription)` to the existing `handleDescriptionChange` callback, and dropped `<VoiceInputControls voice={voice} size="icon-xs" />` next to the Upload button in the chip row.
- **Docker compose** (in `D:\Paperclip - Personal\Docker\docker-compose.yml`, not this repo):
  - `tts:` service image changed from `ghcr.io/matatonic/openedai-speech:latest` to `ghcr.io/remsky/kokoro-fastapi-gpu:latest`. Volume mount path changed from `/app/voices` to `/app/api/src/models`.
  - `paperclip-app-personal` env: `PAPERCLIP_TTS_URL` changed from `http://tts:8000` to `http://tts:8880`.
  - `whisper` service env: `ASR_MODEL` changed from `large-v3-turbo` to `large-v3`.

All edits in this repo are tagged with `// PATCH(nodnarb93): voice-input-everywhere (Patch 8)` comments at insertion sites. Earlier patch comments preserved on the lines they originally touched.

**Commits**: `25710202` (main patch — Kokoro service + Whisper large-v3 + voice extraction + New Issue mic). Follow-ups in the same logical patch: `4a6afecb` (8.1: remove abort-on-close machinery from synthesize route — it was firing spuriously in some Express/Node20/undici combinations, causing fetch to throw "fetch failed" before reaching Kokoro; also adds `err.cause` capture in the 502 path), `<TBD>` (8.2: voice picker switched from OpenAI-compat names like `fable` to Kokoro's native voice packs like `bm_fable`, `bm_george`, etc. — 15 curated English voices grouped by accent+gender via optgroups; legacy localStorage values get auto-migrated to native equivalents on read).

**Tradeoffs / decisions explicitly made**:

1. **Kept the OpenAI-compatible voice names** rather than exposing Kokoro's native voicepack identifiers (`bm_fable`, `af_bella`, etc.). Reasons: (a) existing user localStorage values continue to work unchanged, (b) the OpenAI naming is more familiar to most users than Kokoro's accent_gender_name scheme, (c) Kokoro's compat layer makes this transparent. If we ever want more variety (Kokoro has ~30 voices to OpenAI's 6), we'd expand the picker list in a follow-up.
2. **Hook owns two onChange variants** instead of one. NewIssueDialog needs the lightweight version because its parent state is intentionally NOT updated on every keystroke (perf optimization in the existing code). Giving the hook both variants is cleaner than forcing all consumers into the same pattern.
3. **Did not rename `TtsPlayerModal` even though it's no longer a modal**. Minimizing churn — the rename is purely cosmetic.
4. **Voice input on New Issue lives next to Upload**, not embedded in the description editor itself. Matches the chat composer pattern (mic next to paperclip-attach). Keeps the editor surface clean; concentrates "extra-text-input methods" in one row.
5. **Whisper run-on improvements come from the model swap, not from post-processing.** Considered adding a punctuation-restoration pass server-side, but that's another model load and adds latency. Switching to large-v3 is a cleaner one-flag fix.

**Conflict-resolution note for future upstream merges**:

- The voice extraction touches files already heavily patched by us (IssueChatThread, NewIssueDialog). Future upstream merges should preserve `useVoiceInput` and `VoiceInputControls` invocations; the underlying functions live in new files unique to this fork.
- If upstream restructures `IssueChatThread.tsx` substantially, the only voice-related touchpoints to preserve are: import of `useVoiceInput` + `VoiceInputControls`, the `const voice = useVoiceInput(setBody)` line, the `onChange={voice.onComposerChange}` on the MarkdownEditor, and the `<VoiceInputControls voice={voice} />` in the button row.
- Same for NewIssueDialog: preserve the imports, the `useVoiceInput(setDescription)` call, the `voice.clearUndoOnEdit(nextDescription)` line inside `handleDescriptionChange`, and the `<VoiceInputControls voice={voice} size="icon-xs" />` in the button row.
- Adding voice to more composers in the future: drop in `const voice = useVoiceInput(<setter>); <VoiceInputControls voice={voice} />` and wire `voice.onComposerChange` (or `voice.clearUndoOnEdit`) into the editor's change path.

### Patch 9 — LRU audio cache + last-comment pre-generation

**Why it exists**: every speaker-icon click was costing a fresh 5-15s round trip to Kokoro for synthesis, even when the user was bouncing between the same few comments. Two related improvements bundled together:

1. **Instant repeat plays**: cache synthesized audio in memory and serve from cache on subsequent clicks for the same `(text, voice)` pair.
2. **Instant first play on the most recent comment**: pre-fetch its audio when the chat thread mounts/updates, so the most common click (re-listening to the latest reply) feels instant.

**What it does**:

- **In-memory LRU cache** keyed by `${voice}::${textHash}::${textLength}`. Different voices for the same text are different entries (a voice change doesn't invalidate prior entries — you can flip back and hit cached audio). FNV-1a hash keeps keys bounded for long comments.
- **In-flight dedup**: the cache stores `Blob | Promise<Blob>`. If a click lands while a synthesis is already running for the same key, the second caller awaits the same Promise — no duplicate request.
- **Pin/unpin**: the currently-playing modal pins its entry so an LRU evict doesn't pull the blob URL out from under the `<audio>` element. Unpinned on modal close.
- **Pre-generation**: a useEffect in `IssueChatThread` watches the messages array; when it changes, the most recent user/assistant message's text is fed through `ttsCache.fetch(text, currentVoice)` fire-and-forget. Skips system messages, tool-call-only messages, and any message with empty extractable text.
- **Cache-size setting** in the TTS settings panel: pill row of `5 / 10 / 15 / 25 / 50` (default 15). Stored in localStorage as `paperclip.tts.cacheMaxSize`. When the size shrinks, LRU eviction runs immediately to fit.
- **Persistence**: in-memory only. Cache is lost on page reload. IndexedDB persistence is a possible follow-up if the cache turns out to feel too fragile in real use.

**Where**:

- [ui/src/lib/ttsCache.ts](ui/src/lib/ttsCache.ts) — new file. The cache singleton + `readPreferredVoice()` helper used by both the modal and the pre-gen path (so they share cache keys for the same user-preferred voice). Mirrors the legacy-OpenAI-voice migration table from TtsPlayerModal so a stale localStorage value like `fable` is treated the same way by pre-gen as it is by the modal (both end up at `bm_fable`).
- [ui/src/components/TtsPlayerModal.tsx](ui/src/components/TtsPlayerModal.tsx) — `audioApi.synthesize` calls replaced with `ttsCache.fetch`. `ttsCache.pin` called on entering the synthesize useEffect, with an unpin scheduled on unmount. Added a `cacheMaxSize` state + pill-row UI in the settings panel. Removed the abort signal pattern (Patch 8.1 had already removed it for similar reasons; the cache-fetch path doesn't need it because in-flight dedup handles re-clicks naturally).
- [ui/src/components/IssueChatThread.tsx](ui/src/components/IssueChatThread.tsx) — added a useEffect on the memoized `messages` array that walks backward, finds the most recent text-containing user/assistant message, and calls `ttsCache.fetch` to pre-warm. Fire-and-forget; errors are swallowed.

All edits tagged with `// PATCH(nodnarb93): tts-cache-pregen (Patch 9)` comments at insertion sites.

**Commits**: `<TBD>` (filled in after the patch is committed).

**Tradeoffs / decisions explicitly made**:

1. **In-memory only**, not IndexedDB. Adds complexity (versioning, schema, async API, eviction across two layers). For single-user, cache-lost-on-reload is acceptable — page reloads are infrequent during a working session.
2. **Pre-gen only for the LAST comment**, not the last N. Lowest-cost option that covers the most common "I just want to listen to the AI's reply again" use case. Could expand later if needed.
3. **No "clear cache" button.** Cache clears on page reload; a manual flush hasn't been needed in practice. Easy to add to the settings panel later if it becomes useful.
4. **No visible cache-state UI** (e.g. "audio ready" indicator next to comments). Tradeoff: the cache hit/miss state is implementation detail; surfacing it would be UI noise. Users will feel the cache via instant playback, no explicit indicator needed.
5. **Hash collision risk: vanishingly small** for FNV-1a 32-bit over ~15 entries of comment-length strings. If it ever happens, worst case is one user-visible "audio doesn't match the comment" event before the next click invalidates.
6. **No cache invalidation on comment edit.** If a comment is edited, the hash changes (different text), so the old entry stays in the cache but is unreachable. Eventually LRU-evicted. Minor wasted memory; acceptable.
7. **Pre-gen voice is the *current* preferred voice**, not all voices the user might switch to. Switching voices in the modal triggers a real synthesis (no cache hit) the first time for that new voice on that text — but subsequent plays at the same voice are cached. Acceptable: voice changes are rare relative to repeat plays.

**Conflict-resolution note for future upstream merges**:

- `ttsCache.ts` is unique to this fork — no upstream collision surface.
- Pre-gen useEffect in `IssueChatThread.tsx` is a single self-contained block tagged with `PATCH(nodnarb93): tts-cache-pregen`. If upstream restructures the messages array's plumbing, port the useEffect to use the new shape.
- TtsPlayerModal's cache integration replaces an `audioApi.synthesize` call. If upstream adds their own TTS or modifies the modal, preserve the `ttsCache.fetch` + `ttsCache.pin` calls.
- The `readPreferredVoice` migration table in `ttsCache.ts` duplicates the one in TtsPlayerModal. If you ever change voice migration logic, update both — or refactor into a single shared source.

### Patch 10 — TTS UX polish 2: single-active-modal + cached indicator

**Why it exists**: two real-world UX papercuts after Patch 9 testing:

1. **Multiple TTS modals could be open at once**, with audio stacking — clicking a speaker icon while another was playing or paused stacked the new modal on top, and the audios would play simultaneously (or the new one would play over the paused one). No standard media app does this; every podcast/music app enforces "one at a time."
2. **No visual feedback for what's cached.** With Patch 9's cache + pre-gen, you can't tell from the UI which comments have ready-to-play audio vs. which will need a fresh synthesis. Especially valuable for the pre-gen case (last comment) since "I want instant playback on the latest reply" is the highest-frequency click.

**What it does**:

- **Single-active TTS modal**: a module-level `Set<(open: boolean) => void>` in `TtsButton.tsx` registers every "I'm open" setter. When a button transitions to open, its useEffect iterates the registry and calls `setOpen(false)` on every OTHER registered setter, then adds itself. Cleanup on unmount/close removes from registry. Result: opening a new TTS forces all others to close. Audio from the closed one stops via TtsPlayerModal's existing unmount cleanup (pause + revoke blob URL + unpin cache).
- **Cached visual indicator**: the speaker icon (`Volume2` from lucide) now renders in `text-emerald-500` when `ttsCache.hasReady(text, readPreferredVoice())` returns true. Subtle, non-noisy. Tooltip changes from "Read aloud" to "Read aloud (audio ready)" so the cue is keyboard/screenreader accessible too.
- **Cache emits change events**: `ttsCache` now extends `EventTarget` and fires a single `"change"` event on any mutation (entry added, in-flight promise resolved, error eviction, LRU eviction). Each TtsButton subscribes via useEffect and re-checks its own `hasReady` on every event. Broad-cast (one event for all subscribers) instead of per-key for simplicity; with O(N) comments and O(K) cache mutations the total cost is O(N) per mutation, which is trivial for realistic thread sizes.
- **New `hasReady()` method on the cache**: synchronous boolean check that returns true only when an entry has a *resolved* Blob (skips in-flight Promise entries — we only want to flag "instant playback ready," not "synthesis in progress").

**Where**:

- [ui/src/lib/ttsCache.ts](ui/src/lib/ttsCache.ts) — class now extends `EventTarget`. Added `emitChange()` private helper called on fetch resolution, fetch error eviction, and LRU eviction. New public `hasReady(text, voice)` method.
- [ui/src/components/TtsButton.tsx](ui/src/components/TtsButton.tsx) — module-level `openSetters` registry. Two new useEffects in the component: one subscribes to cache events to maintain `isCached` state, the other registers this button's setOpen with the registry when open transitions to true and closes all others. Speaker icon gains a `text-emerald-500` class when cached. Tooltip text varies by state.

All edits tagged with `// PATCH(nodnarb93): tts-polish-2 (Patch 10)` comments at insertion sites.

**Commits**: `18120dbc`.

**Tradeoffs / decisions explicitly made**:

1. **Module-level Set over React Context.** A context provider for "TTS modal registry" would be cleaner architecturally but would require wrapping every TtsButton parent in a provider. For a feature with N independent buttons that each manage their own modal state, a module-level singleton is simpler and equivalent in behavior. If we ever needed to scope multiple TTS contexts (e.g. preview window + main app), the refactor to context is straightforward.
2. **Broadcast change events, not per-key.** Each cache mutation notifies ALL subscribers. For a thread with 100 comments, every cache mutation triggers 100 useEffect re-checks. Modern React handles this trivially (each is just one hash lookup); the alternative (a per-key event channel) adds complexity for negligible gain.
3. **`hasReady` returns false for in-flight entries.** During the brief window where pre-gen is fetching but hasn't resolved, the speaker stays grey. When the promise resolves, the cache emits change → button re-renders → speaker flips green. Avoids "almost ready but not quite" ambiguity.
4. **`emerald-500` not `green-500`.** Marginally less saturated; reads more "ready/healthy" and less "submit form." Personal aesthetic; trivial to change.
5. **No animation on the green flip.** Considered a brief pulse/glow when the speaker first becomes cached, decided against — it'd be a distracting pop-in for the pre-gen case where the speaker goes green almost immediately on page load. Subtle is better here.

**Conflict-resolution note for future upstream merges**:

- The cache module is unique to this fork.
- TtsButton.tsx is also unique to this fork (added in Patch 5). Future merges should preserve the new useEffects and the module-level registry.
- If upstream ever ships their own TTS feature with similar visual cues, our `emerald-500` class might clash visually — easy to swap.

### Patch 11 — Whisper punctuation fix (VAD + initial_prompt)

**Why it exists**: Whisper large-v3 (even with INT8 quantization, which only marginally affects WER) was producing **multi-paragraph run-on sentences with zero punctuation** on dictations longer than a single sentence. Short dictations got proper punctuation; long ones came back as solid walls of unbroken text. The user even tried being extremely deliberate with verbal pauses and enunciation as cues — the model still produced no punctuation marks.

**Root cause**: Whisper is autoregressive. Once it processes enough audio without emitting punctuation, the model's next-token probability shifts toward continuing in "no-punctuation mode" — and that bias snowballs across the rest of the output. This is well-documented in [openai/whisper#194](https://github.com/openai/whisper/discussions/194) and [openai/whisper#1936](https://github.com/openai/whisper/discussions/1936). On long unsegmented audio it's almost certain to happen.

**Fix**: change two Whisper request parameters in our `/api/audio/transcribe` route. Both are query params on the upstream `whisper-asr-webservice` call:

1. **`vad_filter=true`** (was: default `false`). Enables Voice Activity Detection-based audio segmentation: Whisper processes the audio as multiple short chunks split at natural pauses, instead of one continuous stream. Each chunk gets fresh autoregressive context, so the "stuck in no-punctuation mode" bias can't propagate across chunk boundaries. Bonus: silence/noise gets trimmed, marginal WER improvement.
2. **`initial_prompt`** = a short, varied-punctuation, conversational seed sentence. Whisper conditions its output style on the prompt. With VAD chunking, this prompt also re-seeds each chunk, reinforcing punctuated-style output throughout the entire transcription.
3. **`language=en`** (was: auto-detect). Skips the per-request language detection step. Small reliability + WER win for an English-only user.

**The chosen initial_prompt**:
```
"Okay, here is what I am thinking. First, let us walk through the issue carefully.
Why is this happening? I think we should investigate. Does that make sense? Let me know."
```

Chosen for: ~30 words (enough to establish style without dominating short transcriptions), mix of declarative + interrogative sentences, varied punctuation (periods, commas, question marks), conversational tone matching how the user dictates issue descriptions, no specific domain terms that would leak into transcriptions.

**Where**:

- [server/src/routes/audio.ts](server/src/routes/audio.ts) — the `transcribe` route's call to `${whisperServiceUrl}/asr` now builds query params via `URLSearchParams` (cleaner than the prior hand-concatenated query string) and includes `vad_filter`, `initial_prompt`, and `language` alongside the existing `encode`, `task`, `output`.

Tagged with `// PATCH(nodnarb93): whisper-punctuation (Patch 11)`.

**Commits**: `<TBD>` (filled in after the patch is committed).

**Tradeoffs / decisions explicitly made**:

1. **Hardcoded prompt, not configurable.** Considered making `PAPERCLIP_WHISPER_INITIAL_PROMPT` an env var for per-user customization, but our deployment is single-user and the prompt is a conservative starter. Easy to make configurable later if needed.
2. **`vad_filter=true` is the bigger fix.** The initial_prompt alone helps the start of the transcription but fades. VAD chunking is what actually prevents the no-punctuation mode from propagating. Doing both because they compound.
3. **`vad_filter` may slightly increase latency** for very short clips (it has to run the Silero VAD model). For our typical dictation length (5–60 sec) the overhead is well under 100ms — negligible compared to model inference time.
4. **Did NOT switch to a post-processing punctuation-restoration model** (e.g. `deepmultilingualpunctuation`). Adds another model dependency, another ~few seconds latency, and is overkill if VAD + prompt fix the root cause. Available as a fallback if VAD-only doesn't fully resolve it.
5. **Did NOT pass `condition_on_previous_text`**. faster-whisper has this option but it's actually CONTRARY to what we want — passing previous-text context can REINFORCE the no-punctuation mode rather than break it. VAD chunking accomplishes what we want without this flag.

**Conflict-resolution note for future upstream merges**:

- This patch only modifies the existing `transcribe` route handler in `server/src/routes/audio.ts`. The change is a small query-param expansion; if upstream restructures the route, preserve the four parameters: `vad_filter=true`, `language=en`, `initial_prompt=<the prompt>`, and the existing `encode/task/output`.
- If upstream ever wraps the whisper-asr-webservice call themselves, check whether they handle VAD + prompts. If yes, switch to their handling and drop this patch.

### Patch 12 — TTS hyphen-stripping in identifier-like tokens

**Why it exists**: identifiers like `BIZ-117`, `JIRA-1234`, `CVE-2024-1234` were being spoken as "B I Z **minus** one one seven" — Kokoro pronounces the hyphen as "minus" because it looks like a math expression. Identifiers should sound like "B I Z one one seven" (prefix spelled letter-by-letter, suffix read naturally, no hyphen sound).

**What it does**: a new regex in `normalizeForSpeech()` (the server-side TTS preprocessing function) matches uppercase-alphanumeric tokens connected by hyphens and replaces the hyphens with spaces.

Pattern: `\b([A-Z][A-Z0-9]+(?:-[A-Z0-9]+)+)\b`. Matches require:
- First segment starts with an uppercase letter and is all-uppercase (or uppercase+digits)
- One or more `-alphanumeric-segment` groups follow
- Word boundaries at both ends

Lowercase tokens like `self-driving` or mixed-case like `iOS-app` do NOT match — only obvious identifier shapes. Multi-segment IDs like `CVE-2024-1234` collapse all internal hyphens to spaces in one pass via the callback form of `String.replace`.

**Where**: [server/src/routes/audio.ts](server/src/routes/audio.ts) — added inside `normalizeForSpeech()`, after the dash-to-pause rules and before the file-path normalization. Tagged with `PATCH(nodnarb93): hyphen-tts (Patch 12)`.

**Commits**: `<TBD>`.

**Tradeoffs / decisions**:

1. **Uppercase-prefix only**. Won't fix lowercase issue keys (e.g. `proj-123`). Trade-off: catches the universal company-prefix pattern, avoids mangling normal compound words. If we ever need lowercase support, easy to widen the regex.
2. **No special handling for negative numbers**. `-5` would still be read as "minus five" if it appears as a standalone token, which is actually correct.
3. **Pattern matches the COMPANY prefix style** (`BIZ`, `JIRA`, `INC`, `ENG`, etc.) — agnostic to the actual prefix as the user requested.

**Conflict-resolution**: pure regex addition in `normalizeForSpeech`. No upstream collision surface; the function itself is a fork-only addition from Patch 7.

### Patch 13 — Auto-scroll to bottom on issue load + paired up-arrow

**Why it exists**: every time you load an issue page, you have to manually click the existing down arrow to scroll to the most recent comments. Friction on a high-frequency action.

**What it does**:

1. **Auto-scroll on initial mount**: when `ScrollToBottom` mounts, a polling loop watches the scroll target's `scrollHeight`. Once height hasn't changed for ~300ms (3 polls × 100ms), the page is assumed to be done loading and the scroller is instant-jumped to bottom. "Instant" (not "smooth") to avoid the dizziness the user complained about — visually it feels like the page loaded at the bottom.
2. **Bail-out on user interaction**: if the user touches the wheel, taps the screen, or presses a key before the auto-scroll fires, the auto-scroll is cancelled. Real input wins over default behavior. The check uses `wheel`/`touchstart`/`keydown` listeners with `once: true` — these only fire on genuine user input, not on our own programmatic `scrollTo` calls.
3. **5-second safety timeout** in case content never settles (e.g., infinite-loading page). Bails out silently.
4. **Up-arrow companion**: mirrors the down arrow. Visible when `distanceFromTop > 300`. Renders above the down arrow (`+3rem`) when both are shown so they don't overlap.
5. **Explicit button clicks** still use smooth scroll (user-initiated, conventional).

**Where**: [ui/src/components/ScrollToBottom.tsx](ui/src/components/ScrollToBottom.tsx) — extensive rewrite. The original component was ~85 lines; the new version is ~190 lines mostly due to the auto-scroll polling logic and the up-arrow branch. Tagged with `PATCH(nodnarb93): scroll-bottom (Patch 13)`.

**Commits**: `<TBD>`.

**Tradeoffs / decisions**:

1. **Polling for height stability vs. listening for a "content loaded" event**. Polling is simpler and doesn't require plumbing through context from the messages-loading code. 100ms × 3 ticks (300ms total) feels snappy in practice. If content takes ages to load on a particular issue, the 5s safety timeout fires and the user just sees the page at the top — they can manually click the down arrow as before.
2. **`behavior: "instant"` (not `"smooth"`) for auto-scroll**. Direct user request — smooth scroll on every page load is dizzying. The trade-off is that very fast loads may produce a visible "jump" from top to bottom, but in practice the polling delay means the user rarely sees the top first.
3. **Wheel/touch/key for bail-out, not the `scroll` event**. The `scroll` event would fire from our own `scrollTo`, defeating the purpose. The chosen input events fire only on genuine user input.
4. **Up arrow shown above the down arrow** (not on the opposite side of the screen). Keeps both controls within thumb reach on mobile. The `+3rem` offset is enough vertical space to avoid overlap.

**Conflict-resolution**: file unique to this fork as of v2026.428.0 (verify on next upstream merge — if upstream adds their own scroll-to-bottom, port the auto-scroll + up-arrow features onto theirs).

**UX details**:

- **Deferred spinner**: the recording icon (red square while recording) is the immediate visual signal. A `Loader2` spinner only appears after 3 seconds of transcription wait — local GPU transcriptions usually return in 1-2s, so the spinner avoids flashing for fast requests but still reassures the user for slow ones.
- **Transcript insertion**: appended to the existing body with a single space separator (or set directly if body was empty). Cursor-position insertion was considered and skipped because MDXEditor's Lexical state is not trivially programmable from outside; appending is good enough and predictable.
- **Toast on error**: mic permission denied, network error, no speech detected, etc. — all use `toastActions.pushToast` with dedupe keys to avoid stacking.

**Known tradeoffs**:

1. **MediaRecorder format depends on the browser.** Chrome on desktop/Android typically produces `audio/webm;codecs=opus`, Safari produces `audio/mp4;codecs=aac`. Whisper-asr-webservice handles both fine via ffmpeg's `encode=true` flag, but the mime preservation in our blob → form append chain assumes the browser-default is acceptable. If iOS Safari ever becomes a target this is worth re-testing.
2. **Double-click race.** Two rapid clicks before `getUserMedia` resolves could in principle start two streams. The window is small (the permission prompt + async resolution) but not zero. Not guarded — fix if it ever bites.
3. **Always-on mic button.** The button is rendered unconditionally in the composer's left cluster, even in surfaces where `onImageUpload`/`onAttachImage` are not wired. That's intentional (voice is useful everywhere), but it does change the rendering of the left cluster from "conditional div" to "always div, conditional contents." Visual layout should be unaffected since `mr-auto` still does its job.
4. **No-speech detection lives in the response shape, not an error.** Whisper returns `{ text: "" }` for empty/silent recordings — the UI treats empty transcript as a warn-toast rather than a transcription error. Don't confuse `transcript === ""` with a request failure when reading the code.
5. **`large-v3-turbo` model has slightly weaker non-English / translation performance** than full `large-v3`. For English dictation it's a wash; if I ever start dictating in another language and accuracy drops, switch `ASR_MODEL` in docker-compose to `large-v3` (~6 GB VRAM instead of ~2 GB).

**Conflict-resolution note for future upstream merges**:

- `MarkdownEditor.tsx` is *not* touched by this patch — it's all in `IssueChatThread.tsx` and new files. So Patch 1 and Patch 3 don't conflict with each other.
- If upstream meaningfully restructures `IssueChatThread.tsx` (especially the composer button row at ~line 2973 in v2026.428.0), find the new equivalent of the attach button's wrapper `<div>` and apply the same "make the left cluster always render, put attach inside fragment, put mic + spinner unconditionally" pattern. The `PATCH(nodnarb93)` comments mark each site.
- If upstream eventually adds a composer-toolbar extension slot to the plugin SDK (per their triage of #3907), consider migrating Patch 3 into a plugin instead. That would isolate the change from upstream churn entirely. Until then, fork-level patch is the only option.
- If upstream changes `server/src/app.ts`'s `createApp` opts shape, keep `whisperServiceUrl` in opts; if they add their own opts in the same area, alphabetize and move on.

## Notes on upstream's build (so you don't have to re-derive it)

- Package manager: `pnpm@9.15.4` via corepack. Engine: Node `>=20`.
- Build command: `pnpm install --frozen-lockfile` then three filtered builds — `pnpm --filter @paperclipai/ui build`, `pnpm --filter @paperclipai/plugin-sdk build`, `pnpm --filter @paperclipai/server build`. The reference is upstream's root `Dockerfile`.
- Server entrypoint: `scripts/docker-entrypoint.sh`, then `node --import ./server/node_modules/tsx/dist/loader.mjs server/dist/index.js`.
- Default port: `3100`. Default volume: `/paperclip`.

If upstream's `Dockerfile` changes meaningfully across releases, mirror those changes into my Dockerfile in `D:\Paperclip - Personal\Docker\` rather than diverging silently.
