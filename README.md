# TokenBurn 🔥

**Watch your Claude Code tokens burn in real time. Local, open source, slightly judgmental.**

```bash
npx tokenburn
```

TokenBurn reads the transcript logs Claude Code already writes on your machine and turns them into a live dashboard: a big glowing counter that ticks while you work, history by day / week / month / project / model, what it all *would* have cost at API prices, and a lake that slowly drains as your estimated water footprint grows.

It runs 100% locally. No accounts, no telemetry, nothing leaves your machine.

> Not affiliated with or endorsed by Anthropic.

## Install

Requires Node 20+.

```bash
npx tokenburn            # one-off: parse logs, start the dashboard, open the browser
npm i -g tokenburn       # or install globally for the status line
```

## Modes

| Command | What it does |
|---|---|
| `tokenburn` | Dashboard at `http://127.0.0.1:4242`, live-updating as you use Claude Code |
| `tokenburn --summary` | Compact table in the terminal |
| `tokenburn --json` | All aggregates as JSON, for scripting |
| `tokenburn statusline` | One line for Claude Code's custom status line |

Options: `--dir <path>` (logs location), `--port <n>`, `--no-open`, `--no-cache`, `--days <n>`, `--project <key>`, `--model <id>`. Run `tokenburn --help` for the full list.

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

Claude Code passes the current `session_id` on stdin, which is how the session figure is found. The command only reads files modified today (plus the current session's file), so it stays fast with gigabytes of history. Use a global install rather than `npx` here so it does not hit the network on every refresh.

## Where the numbers come from

**Tokens.** Claude Code writes JSONL transcripts to `~/.claude/projects/**/*.jsonl` (or `$CLAUDE_CONFIG_DIR/projects`). Each assistant turn carries `model` and `usage` with input, output, cache-write and cache-read token counts. The same message is written several times (once per content block), so TokenBurn de-duplicates on message id + request id across all files. Subagent transcripts are included. The observed format is documented in [docs/log-format.md](docs/log-format.md).

**Cost.** Every cost in the UI is **API-equivalent**: what the same tokens would cost on pay-as-you-go at the prices on [Anthropic's pricing page](https://platform.claude.com/docs/en/about-claude/pricing). Prices live in [`src/pricing.json`](src/pricing.json) with the date they were checked. If you are on a Pro or Max subscription you are not billed per token, so treat it as a "what if". Models missing from the table are shown with cost "unknown" rather than a guess. Cache writes are priced by TTL (5-minute vs 1-hour) when the log records the split.

**Water and energy (the lake).** There is no official per-token figure from Anthropic, so this is deliberately labelled *rough estimate, for fun*. The defaults in [`src/footprint.json`](src/footprint.json):

- 600 Wh per million **output** tokens, derived from the widely cited ~0.3 Wh per typical chat response of a few hundred tokens ([Epoch AI](https://epoch.ai/gradient-updates/how-much-energy-does-chatgpt-use)) and consistent with the ~0.34 Wh median for frontier-scale models in [Energy Use of AI Inference (2025)](https://arxiv.org/abs/2509.20241).
- Input, cache-write and cache-read tokens are weighted at 0.1, 0.1 and 0.01 of an output token. Prefill is far cheaper than generation and cache hits cheaper still; the exact ratios are a judgement call, not a measurement.
- 2 litres of water per kWh, a blend of on-site cooling and a share of power-generation water ([Making AI Less "Thirsty"](https://arxiv.org/abs/2304.03271)).

The result is then expressed on a ladder: sips → cups → bottles → buckets → bathtubs → hot tubs → backyard pools → Olympic pools → a small lake. The lake drains on a log scale from one sip to one small lake. Every factor is editable in the dashboard settings and saved to `~/.tokenburn/config.json`. Please do not quote these numbers as fact.

## Privacy

- Reads log files only. Never writes to them.
- Reads only the `usage`, `model`, `timestamp`, id and `cwd` fields. Prompt and response content is never parsed, stored or displayed.
- The server binds to `127.0.0.1` only and rejects cross-origin requests.
- No network calls, ever. No fonts, analytics or update checks.
- The only files TokenBurn writes are `~/.tokenburn/config.json` (your settings) and `~/.tokenburn/cache.json` (parsed token counts, so large histories load fast). Delete them any time; `--no-cache` skips the cache.

## FAQ

**Does this include claude.ai web or desktop chat usage?**
No. Those don't expose token counts and scraping undocumented endpoints is fragile. TokenBurn covers Claude Code only.

**Why is cost "unknown" for some sessions?**
The model id isn't in `src/pricing.json`. Add it (or open a PR) and the cost appears.

**Why are cache reads such a big share?**
Claude Code sends your whole conversation on every turn and most of it is served from the prompt cache. That's normal, and it's why cache-read pricing is ~10x cheaper. Use "Without cache reads" on the tokens chart to see the rest.

**The numbers don't match `/usage` exactly.**
`/usage` is per session and live. TokenBurn de-duplicates across files and counts subagent usage, so small differences are expected. Large differences are a bug: please file an issue with `tokenburn --json` output (it contains no content).

**Logs live somewhere else.**
`tokenburn --dir /path/to/.claude` or set `CLAUDE_CONFIG_DIR`.

**Windows?**
Logs are read from `%USERPROFILE%\.claude\projects`. The dashboard and summary modes work; the status line works with `tokenburn statusline` too.

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

MIT. Not affiliated with or endorsed by Anthropic. Costs are estimates; water and energy figures are rough and for fun.
