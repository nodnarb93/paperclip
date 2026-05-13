---
name: paperclip-edit-agent
description: >
  Edit the contents of an existing agent's instruction-bundle files (AGENTS.md,
  HEARTBEAT.md, SOUL.md, etc.). Use when you need to modify another agent's
  behavior, not when creating a new agent (use paperclip-create-agent for that).
---

# Paperclip Edit Agent Skill

Use this skill when the Board user asks you to change an existing agent's
instruction files. Companion to `paperclip-create-agent`, which handles
hiring new agents.

## Preconditions

You need either:

- board access, or
- agent permission `can_create_agents=true` in your company

The `can_create_agents` permission gates *both* creating new agents and
editing existing agents' files. The rationale: an agent already authorized
to write a new agent's complete instruction bundle inline at creation time
is trusted to edit one later. If you don't have this permission, escalate
to the Board user.

## What this skill is NOT for

- **Not for creating new agents.** Use `paperclip-create-agent`.
- **Not for adding new files to an existing bundle.** This skill edits the
  contents of files that already exist. If an agent has only `AGENTS.md` and
  needs a new `HEARTBEAT.md`, ask the Board user to create the empty file
  on the host filesystem first, then resume editing with this skill.
- **Not for deleting files, renaming files, or moving the bundle.** Those
  operations are board-only and intentionally outside the scope of this
  skill. If a deletion or restructure is what's needed, escalate to the
  Board user.

## Workflow

### 1. Confirm identity and company context

```sh
curl -sS "$PAPERCLIP_API_URL/api/agents/me" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY"
```

### 2. Find the target agent

If the Board user named the target agent (e.g. "the CTO"), list company
agents and find its UUID:

```sh
curl -sS "$PAPERCLIP_API_URL/api/companies/$PAPERCLIP_COMPANY_ID/agents" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY"
```

### 3. Read the target's current instruction files

Before proposing any edit, read the file(s) you intend to change. Never
edit blind. The bundle metadata lists which files exist:

```sh
curl -sS "$PAPERCLIP_API_URL/api/agents/<target-agent-id>/instructions-bundle" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY"
```

Then fetch each file's content:

```sh
curl -sS "$PAPERCLIP_API_URL/api/agents/<target-agent-id>/instructions-bundle/file?path=AGENTS.md" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY"
```

The response includes `content` (the file text). Use this as the basis
for your edit.

### 4. Propose the edit conversationally

Per your own agent's communication style, describe the proposed change
in plain English on the conversation issue. Do not paste diffs or
literal file content in the comment unless the Board user asks. Reassign
the conversation issue to the Board user for approval.

### 5. Apply the approved edit

Once the Board user approves, PUT the new full file content. The endpoint
overwrites the entire file with what you send — there's no partial-edit
or patch shape, so make sure you're sending the complete final content,
not just a diff:

```sh
FILE_CONTENT=$(cat <<'CONTENT'
<the full new file body, verbatim>
CONTENT
)

JSON_PAYLOAD=$(python3 -c "import json, sys; print(json.dumps({'path': 'AGENTS.md', 'content': sys.stdin.read()}))" <<<"$FILE_CONTENT")

curl -sS -X PUT \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  -H "X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID" \
  -H "Content-Type: application/json" \
  -d "$JSON_PAYLOAD" \
  "$PAPERCLIP_API_URL/api/agents/<target-agent-id>/instructions-bundle/file"
```

A 200 response means the write succeeded. The response body includes
the new file's metadata (size, mtime).

### 6. Verify the write

GET the file back and confirm the content matches what you sent. If a
PUT failed, retry once; if it still fails, post a comment on the
conversation issue describing exactly what was changed, what wasn't,
and what the Board user would need to fix manually.

### 7. Confirm with the Board user

Post a brief, plain-spoken confirmation on the conversation issue (per
your agent's communication style — most meta-agents use TTS-friendly
language since the Board user is listening). Do NOT reassign the
conversation issue back to the Board user — execution confirmations are
purely informational.

## Common error responses

- **403 "Only board-authenticated callers or agents with canCreateAgents
  permission can write instruction-bundle files"**: your agent doesn't
  have `can_create_agents` permission. Escalate to the Board user.
- **404 "Agent not found"**: the target agent UUID is wrong. Re-list
  company agents and re-check.
- **422 from the upsert schema**: the request body is malformed. Both
  `path` and `content` must be strings; `path` must be non-empty after
  trim.

## References

- API endpoint shapes:
  - `GET /api/agents/<id>/instructions-bundle` — list bundle files
  - `GET /api/agents/<id>/instructions-bundle/file?path=<rel>` — read one
  - `PUT /api/agents/<id>/instructions-bundle/file` — write one
