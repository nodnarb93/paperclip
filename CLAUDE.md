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

## First motivating patch (TBD)

The original reason I started this fork was the **entry-file display bug in the agent Instructions UI**: see [upstream issue #2068](https://github.com/paperclipai/paperclip/issues/2068).

It may already be fixed in `v2026.428.0` (the tag this fork is currently pinned to). **Status: to be verified after the first rebuild.** Once I've confirmed whether it's fixed:

- **If fixed**: delete this section.
- **If not fixed**: write the patch on `local-main`, commit it with a message referencing #2068, and update this section to *"First patch applied: see commit `<sha>`."*

## Notes on upstream's build (so you don't have to re-derive it)

- Package manager: `pnpm@9.15.4` via corepack. Engine: Node `>=20`.
- Build command: `pnpm install --frozen-lockfile` then three filtered builds — `pnpm --filter @paperclipai/ui build`, `pnpm --filter @paperclipai/plugin-sdk build`, `pnpm --filter @paperclipai/server build`. The reference is upstream's root `Dockerfile`.
- Server entrypoint: `scripts/docker-entrypoint.sh`, then `node --import ./server/node_modules/tsx/dist/loader.mjs server/dist/index.js`.
- Default port: `3100`. Default volume: `/paperclip`.

If upstream's `Dockerfile` changes meaningfully across releases, mirror those changes into my Dockerfile in `D:\Paperclip - Personal\Docker\` rather than diverging silently.
