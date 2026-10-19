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

---

# OpenAI Codex log format (as observed)

TokenBurn also reads the JSONL "rollout" files the Codex CLI and Codex desktop
app write locally. This section records what was observed on one machine
(241 rollout files, Codex CLI `0.125` to `0.162`, models `gpt-5.2` to
`gpt-6.1-sol`, macOS, October 2026). Only line types, key names and usage,
model, timestamp, id and cwd values were inspected; message content was not
read.

## Location

```
~/.codex/sessions/YYYY/MM/DD/rollout-<local-time>-<session-uuid>.jsonl
~/.codex/archived_sessions/rollout-<local-time>-<session-uuid>.jsonl
```

- `CODEX_HOME` overrides `~/.codex` when set. `--codex-dir` overrides both and
  may point at the Codex home, at `sessions/` or `archived_sessions/`, or at any
  folder of rollout files.
- Archiving a session moves its file from `sessions/` to `archived_sessions/`.
  The same session never appeared in both, but if it did the events would be
  de-duplicated (see below).
- Everything else in `~/.codex` (sqlite databases, `session_index.jsonl`,
  `history`, config) is ignored.

## Line types

Every line is `{ "timestamp", "type", "payload" }` (newer versions add
`ordinal` and sometimes `metadata`). Observed counts:

```
response_item 50727   event_msg 42303   token_usage_record 5713
turn_context   1588   world_state 442   session_meta 241   compacted 71
```

Within `event_msg`, `payload.type` was one of `item_completed`, `token_count`,
`task_started`, `task_complete`, `thread_settings_applied`, `turn_aborted`.

TokenBurn reads only four kinds of line. Everything else (including every
`response_item`, which holds prompts, replies, reasoning and tool output) is
skipped before it is parsed.

## Fields read by TokenBurn

```jsonc
// once per file, first line
{ "timestamp": "2026-04-27T09:47:41.645Z", "type": "session_meta",
  "payload": { "id": "019dce56-...", "cwd": "/Users/alice/my-app",
               "cli_version": "0.125.0-alpha.3", "originator": "Codex Desktop", ... } }

// at the start of every turn; the model can change mid-session
{ "type": "turn_context",
  "payload": { "model": "gpt-5.6-sol", "cwd": "/Users/alice/my-app", "effort": "high", ... } }

// after each model response
{ "timestamp": "2026-04-27T09:48:27.152Z", "type": "event_msg",
  "payload": { "type": "token_count",
    "info": {
      "total_token_usage": { "input_tokens": 16326, "cached_input_tokens": 12672,
        "cache_write_input_tokens": 0, "output_tokens": 59,
        "reasoning_output_tokens": 15, "total_tokens": 16385 },
      "last_token_usage":  { /* same keys */ },
      "model_context_window": 258400 },
    "rate_limits": { ... } } }

// Codex 0.145+: one per API response, written just before its token_count
{ "type": "token_usage_record",
  "payload": { "response_id": "resp_0efd...", "session_id": "019f...", "thread_id": "019f...",
    "turn_id": "01a1...", "usage": { /* per response */ },
    "turn_token_usage": { /* running total for the turn */ },
    "thread_token_usage": { /* running total for the session */ } } }
```

Fields read: `timestamp`, `type`, `payload.type`, `session_meta.payload.id`
and `.cwd`, `turn_context.payload.model` and `.cwd`, the usage objects, and
`token_usage_record.payload.response_id`.

## What the numbers mean

- `last_token_usage` (and `token_usage_record.usage`) is one API response.
  `total_token_usage` is a running total for the session.
- `input_tokens` is every prompt token. `cached_input_tokens` and
  `cache_write_input_tokens` are subsets of it (cached was never larger than
  input; cache writes were always 0). OpenAI's pricing page says input tokens
  are "either Input, Cached Input, or Cache Write". TokenBurn maps:
  input = input_tokens − cached − cache_write, cacheRead = cached,
  cacheWrite = cache_write.
- `output_tokens` already includes `reasoning_output_tokens`: in every
  non-empty event `total_tokens == input_tokens + output_tokens`. Reasoning is
  not added a second time.
- The model comes from the latest `turn_context`; the project from its `cwd`,
  encoded like Claude Code's folder names (every non-alphanumeric character
  becomes `-`) so a folder used with both tools shows as one project.

## Duplicates and resets (important)

- **Repeated totals.** A `token_count` can be written again with an identical
  `total_token_usage` (236 times on the test machine), e.g. after a resume.
  These are dropped.
- **Empty updates.** `info` is `null` on rate-limit-only updates (skipped).
  Around compaction a `token_count` can carry zero for every field except
  `total_tokens` (86 times); it has no usage and is skipped.
- **Totals go backwards.** After a resume or rollback `total_token_usage` can
  drop (7 times), sometimes back to an exact earlier value. Taking the
  difference of running totals would lose real usage, so TokenBurn sums the
  per-response numbers instead, and drops a token_count whose running total was
  already seen in that session.
- **Two records of one response.** Since Codex 0.145 each response has a
  `token_usage_record` followed by a `token_count` echoing the same usage
  (5671 of 5712 times; the rest echoed an empty update). TokenBurn counts the
  record (key `codex:<response_id>`) and skips the echo. 42 records had no
  token_count of their own (about 10M tokens), so using records where present
  is slightly more complete than token_count alone.
- **Mixed files.** A session started on an older CLI and resumed on a newer
  one has only token_count lines in its first part. Those are counted as above
  (key `codex:<session id>:<total_token_usage>`).

On the test machine this gave 1.75B tokens across 15,098 responses, against
1.74B from token_count lines alone.

## Edge cases

- Partially written lines while a session is live: same handling as for Claude
  Code (the trailing partial line is buffered until its newline arrives).
- Parser state (current model, cwd, session id, last total, pending record) is
  kept per file and saved in the cache, so tailing a file resumes correctly.
- Models missing from `src/pricing-openai.json` keep cost "unknown".
