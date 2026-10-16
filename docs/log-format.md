# Claude Code log format (as observed)

TokenBurn reads the JSONL transcripts Claude Code writes locally. This document
records the actual shape observed on a real machine (Claude Code `2.1.x`,
macOS, October 2026) so the parser is based on evidence, not assumptions.

## Location

```
~/.claude/projects/<project-folder>/<session-id>.jsonl
~/.claude/projects/<project-folder>/<session-id>/subagents/**/agent-*.jsonl
```

- `<project-folder>` is the working directory with `/` replaced by `-`, e.g.
  `-Users-alice-my-app`. Folder names can contain real dashes too, so the folder
  name alone cannot be decoded back into a path reliably. Entries also carry a
  `cwd` field; TokenBurn uses `basename(cwd)` for the display name and the folder
  name as the stable key.
- Subagent transcripts live in nested folders under the session folder (up to 6
  levels deep was observed: `.../subagents/workflows/<wf-id>/agent-*.jsonl`).
  They contain real API usage and are counted.
- Other things in a project folder (e.g. a `memory/` directory) are ignored.
- `CLAUDE_CONFIG_DIR` overrides `~/.claude` when set.

## Line types

Each line is one JSON object with a `type` field. Observed types and counts on
one machine:

```
assistant, user, attachment, last-prompt, custom-title, atis-latch, agent-name,
queue-operation, mode, system, pr-link, bridge-session, file-history-snapshot,
file-history-delta, frame-link, artifact-autoreact-ledger, started, result,
cost-state, artifact-comment-monitor, relocated, launched, isolation-latch
```

Only `type: "assistant"` lines carry token usage. Everything else is skipped.

## Assistant entry (fields we read)

```jsonc
{
  "type": "assistant",
  "uuid": "29629141-...",            // unique per line
  "parentUuid": "665861e0-...",
  "sessionId": "0ce855e8-...",       // same as the file name for main sessions
  "requestId": "req_011Cg5JToZG9...", // one per API request
  "timestamp": "2026-10-16T04:41:17.239Z",
  "cwd": "/Users/alice/my-app",
  "isSidechain": false,              // true inside subagent transcripts
  "version": "2.1.295",
  "message": {
    "id": "msg_011Cg5JTpLPy...",     // API message id
    "model": "claude-opus-5-5",
    "role": "assistant",
    "content": [ /* NEVER read by TokenBurn */ ],
    "usage": {
      "input_tokens": 2,
      "output_tokens": 326,
      "cache_creation_input_tokens": 26662,
      "cache_read_input_tokens": 46865,
      "cache_creation": {
        "ephemeral_5m_input_tokens": 0,
        "ephemeral_1h_input_tokens": 26662
      },
      "output_tokens_details": { "thinking_tokens": 47 },
      "service_tier": "standard",
      "speed": "standard"
    }
  }
}
```

Fields read by TokenBurn: `type`, `timestamp`, `sessionId`, `requestId`,
`cwd`, `isSidechain`, `message.id`, `message.model`, `message.usage.*`.
`message.content` is never parsed, kept or displayed.

## Duplicates (important)

The same API response is written as **multiple lines**: one line per content
block (thinking, text, each tool_use). Every one of those lines repeats the
identical `message.id`, `requestId` and `usage`. Up to 5 lines per message were
observed. Counting each line would overstate usage several times over.

The same `message.id` was also found in more than one file (resumed sessions,
forked sessions, subagent transcripts copied into a parent).

De-dupe key: `message.id + ":" + requestId`, applied globally across all files.
First occurrence wins.

## Edge cases observed

- `message.model` can be `"<synthetic>"` with all-zero usage. These are
  client-generated messages (e.g. interruptions) and are skipped.
- `cache_creation` may be absent on older entries; fall back to
  `cache_creation_input_tokens` priced as a 5-minute cache write.
- `usage` fields can be missing or `null` on `<synthetic>` entries; treat
  missing numbers as 0.
- Dated model ids appear (`claude-haiku-4-5-20251001`); pricing lookup strips
  the date suffix.
- Lines can be partially written while a session is live. The live watcher
  keeps the trailing partial line in a buffer until the newline arrives.
- Malformed lines (not JSON, or not an object) are skipped and counted as
  warnings.
