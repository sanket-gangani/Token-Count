# TokenBurn 🔥

**Watch your Claude Code and Codex tokens burn in real time. Local, open source, slightly judgmental.**

```bash
npx burntokens
```

TokenBurn reads the logs Claude Code and OpenAI Codex already write on your machine and turns them into a live dashboard: a big glowing counter that ticks while you work, history by day / week / month / project / model, Claude Code and Codex side by side (or combined), what it all *would* have cost at API prices, and a lake that slowly drains as your estimated water footprint grows.

It runs 100% locally. No accounts, no telemetry, nothing leaves your machine.

> Not affiliated with or endorsed by Anthropic or OpenAI.

## Install

Requires Node 20+. The npm package is called `burntokens` (the name `tokenburn` was too close to an existing package). Once installed, the command is `tokenburn` (`burntokens` works too).

```bash
npx burntokens           # one-off: parse logs, start the dashboard, open the browser
npm i -g burntokens      # or install globally; this gives you the `tokenburn` command
```

## Modes

| Command | What it does |
|---|---|
| `tokenburn` | Dashboard at `http://127.0.0.1:4242`, live-updating as you use Claude Code or Codex |
| `tokenburn --summary` | Compact table in the terminal |
| `tokenburn --json` | All aggregates as JSON, for scripting |
| `tokenburn statusline` | One line for Claude Code's custom status line |

Options: `--dir <path>` (Claude Code logs), `--codex-dir <path>` (Codex logs), `--source claude|codex|all`, `--port <n>`, `--no-open`, `--no-cache`, `--days <n>`, `--project <key>`, `--model <id>`. Run `tokenburn --help` for the full list.

Both tools are read by default and combined everywhere. `--source codex` (or `claude`) narrows `--summary` and `--json` to one of them; in the dashboard, use the Sources filter next to Projects and Models, or click either side of the split under the big counter.

## Status line

Claude Code can show a custom status line under its prompt. Add this to `~/.claude/settings.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "tokenburn statusline"
  }
}
```

It prints something like:

```
302.6M session · 🔥 331.2M today · $128.73 api-eq · ≈11 water bottles
```

Claude Code passes the current `session_id` on stdin, which is how the session figure is found. The status line counts Claude Code usage only. The command only reads files modified today (plus the current session's file), so it stays fast with gigabytes of history. Use a global install (`npm i -g burntokens`) rather than `npx` here so it does not hit the network on every refresh.

## Where the numbers come from

**Tokens (Claude Code).** Claude Code writes JSONL transcripts to `~/.claude/projects/**/*.jsonl` (or `$CLAUDE_CONFIG_DIR/projects`). Each assistant turn carries `model` and `usage` with input, output, cache-write and cache-read token counts. The same message is written several times (once per content block), so TokenBurn de-duplicates on message id + request id across all files. Subagent transcripts are included.

**Tokens (Codex).** Codex writes one JSONL rollout per session to `~/.codex/sessions/YYYY/MM/DD/` and `~/.codex/archived_sessions/` (or under `$CODEX_HOME`). After each model response it logs a `token_count` event with that response's usage, and newer versions also log a `token_usage_record` with the response id. TokenBurn counts each response once: cached input becomes cache reads, the rest of the prompt is input, and output already includes reasoning tokens. Repeated totals (written again on resume) are dropped. The model comes from the session's latest `turn_context`. A folder you use with both tools shows up as one project.

Both formats, and the evidence behind these rules, are documented in [docs/log-format.md](docs/log-format.md).

**Cost.** Every cost in the UI is **API-equivalent**: what the same tokens would cost on pay-as-you-go at the prices on [Anthropic's pricing page](https://platform.claude.com/docs/en/about-claude/pricing) and [OpenAI's pricing page](https://developers.openai.com/api/docs/pricing) (Standard tier). Prices live in [`src/pricing.json`](src/pricing.json) and [`src/pricing-openai.json`](src/pricing-openai.json) with the date they were checked. If you are on a Claude Pro/Max or ChatGPT subscription you are not billed per token, so treat it as a "what if". Models missing from the tables are shown with cost "unknown" rather than a guess. Claude cache writes are priced by TTL (5-minute vs 1-hour) when the log records the split; OpenAI's long-context rates apply to prompts over 272K tokens.

**Water and energy (the lake).** There is no official per-token figure from Anthropic or OpenAI, so this is deliberately labelled *rough estimate, for fun*. The defaults in [`src/footprint.json`](src/footprint.json):

- 600 Wh per million **output** tokens, derived from the widely cited ~0.3 Wh per typical chat response of a few hundred tokens ([Epoch AI](https://epoch.ai/gradient-updates/how-much-energy-does-chatgpt-use)) and consistent with the ~0.34 Wh median for frontier-scale models in [Energy Use of AI Inference (2025)](https://arxiv.org/abs/2509.20241).
- Input, cache-write and cache-read tokens are weighted at 0.1, 0.1 and 0.01 of an output token. Prefill is far cheaper than generation and cache hits cheaper still; the exact ratios are a judgement call, not a measurement.
- 2 litres of water per kWh, a blend of on-site cooling and a share of power-generation water ([Making AI Less "Thirsty"](https://arxiv.org/abs/2304.03271)).

The result is then expressed on a ladder: sips → cups → bottles → buckets → bathtubs → hot tubs → backyard pools → Olympic pools → a small lake. The lake drains on a log scale from one sip to one small lake. Every factor is editable in the dashboard settings and saved to `~/.tokenburn/config.json`. Please do not quote these numbers as fact.

## Privacy

- Reads Claude Code and Codex log files only. Never writes to them. Nothing else in `~/.codex` (auth, config, databases) is opened.
- Reads only the `usage`, `model`, `timestamp`, id and `cwd` fields. Prompt and response content is never parsed, stored or displayed.
- The server binds to `127.0.0.1` only and rejects cross-origin requests.
- No network calls, ever. No fonts, analytics or update checks.
- The only files TokenBurn writes are `~/.tokenburn/config.json` (your settings) and `~/.tokenburn/cache.json` (parsed token counts, so large histories load fast). Delete them any time; `--no-cache` skips the cache.

## FAQ

**Which tools does it read?**
Claude Code and OpenAI Codex (the Codex CLI and the Codex desktop app both write the same rollout logs). Both are on by default and combined; filter to one with `--source` or the dashboard's Sources filter.

**Does this include claude.ai or ChatGPT web/desktop chat usage?**
No. Those don't expose token counts locally and scraping undocumented endpoints is fragile. TokenBurn covers Claude Code and Codex only.

**Why is cost "unknown" for some sessions?**
The model id isn't in `src/pricing.json` (Claude) or `src/pricing-openai.json` (OpenAI). Add it (or open a PR) and the cost appears.

**My Codex total doesn't match what Codex shows.**
Codex's built-in numbers can cover a different scope. TokenBurn adds up each response across every session, including archived ones, and drops totals Codex writes twice when a session is resumed. Small differences are expected; large ones are a bug, please file an issue with `tokenburn --json --source codex` output.

**Why are cache reads such a big share?**
Claude Code sends your whole conversation on every turn and most of it is served from the prompt cache. That's normal, and it's why cache-read pricing is ~10x cheaper. Use "Without cache reads" on the tokens chart to see the rest.

**The numbers don't match `/usage` exactly.**
`/usage` is per session and live. TokenBurn de-duplicates across files and counts subagent usage, so small differences are expected. Large differences are a bug: please file an issue with `tokenburn --json` output (it contains no content).

**Logs live somewhere else.**
Claude Code: `tokenburn --dir /path/to/.claude` or set `CLAUDE_CONFIG_DIR`. Codex: `tokenburn --codex-dir /path/to/.codex` or set `CODEX_HOME`.

**Windows?**
Logs are read from `%USERPROFILE%\.claude\projects` and `%USERPROFILE%\.codex`. The dashboard and summary modes work; the status line works with `tokenburn statusline` too.

## Development

```bash
npm install
npm start              # build everything, then run the dashboard (easiest)
npm run dev            # build the dashboard, run the CLI from TypeScript source
npm test               # vitest, synthetic fixtures only
npm run build          # tsc + vite → dist/
npm run dev:web        # vite dev server for the dashboard (proxies /api to :4242)
```

If port 4242 is taken (for example an older TokenBurn is still running), the next free port is used and printed in the terminal.

Layout: `src/` is the CLI + server (discover → parse → aggregate → cost/footprint → server/watch), `web/` is the Vite + React dashboard, `test/fixtures/` holds synthetic JSONL (no real data).

## License

MIT. Not affiliated with or endorsed by Anthropic or OpenAI. Costs are estimates; water and energy figures are rough and for fun.
