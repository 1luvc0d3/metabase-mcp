# Demo pipeline

Verifies features through a real Claude Code session and records the demo video from the same
scenarios. macOS first; the scripts are plain Node and should run on Linux too (untested there yet).

| Step | Command | What it does |
|---|---|---|
| Setup | `npm run demo:setup` | Prepares a throwaway Metabase and writes the MCP configs to `demo/.out/` |
| Verify | `npm run demo:verify` | Runs each scenario headlessly with `claude -p` and checks the tool calls and results |
| Record | `npm run demo:record` | Records a terminal take per scenario (VHS), Metabase browser shots (Playwright), title cards, and joins them into `demo/.out/metabase-mcp-demo.mp4` |

Scenarios live in [`scenarios.mjs`](scenarios.mjs): a prompt, the server profile, and a `check`
that inspects the tool calls. When you ship a feature worth showing, add a scenario. `verify`
then tests it through the model, and `record` films it.

## Prerequisites

- Docker, Node 22.12+, and Claude Code logged in (`claude`). The pipeline uses your login.
- Recording: `brew install vhs ffmpeg` (VHS brings `ttyd`) and `npx playwright install chromium`.

## Run it

```bash
docker run -d --name metabase-mcp-demo -p 127.0.0.1:3100:3000 metabase/metabase:latest
npm run build
METABASE_URL=http://localhost:3100 npm run demo:setup   # waits for Metabase to boot
npm run demo:verify                                     # Haiku, about $0.01
npm run demo:verify -- --model sonnet                   # the model you'll record with
npm run demo:record                                     # ~6 min; Sonnet by default
docker rm -f metabase-mcp-demo
```

Useful flags:

- `--only workflow,guardrails` (verify and record): run a subset. Re-recording one scene
  replaces its clip, then the video is re-assembled from all clips.
- `--assemble` (record): rebuild the video from existing clips without re-recording.
- `--model <alias>` (both).
- `SERVER_ENTRY=/path/to/dist/index.js npm run demo:setup`: point the configs at another build,
  such as an unmerged branch.

## How the takes stay clean

- Claude runs from an empty folder (`/tmp/metabase-mcp-demo`) with `--strict-mcp-config`,
  `--setting-sources ''` and `--tools ''`. Only the demo MCP server's tools exist, and your hooks,
  plugins, permissions and CLAUDE.md files are not loaded.
- The server's tools are pre-approved (`--allowedTools mcp__metabase`), so no permission prompt
  interrupts a take. `--verbose` expands each tool call so the SQL is on screen.
- Claude Code's startup banner stays visible. It shows the Claude Code version, the model, your
  plan name and the stage folder.
- The first time, the recorder accepts Claude Code's folder-trust prompt for the stage folder
  off camera.

## Things to know

- Every take is a live model run. Watch the video before publishing and re-take
  (`--only <id>`) any scene that went sideways. `verify` with the same model first makes that rare.
- VHS 0.12 can't wait for text once the output scrolls. Each take therefore runs for
  `maxSeconds` (default 90), and the recorder trims the idle tail by detecting when the screen
  stopped changing. If a scene prints "Claude may still have been working", raise its `maxSeconds`.
- Scenarios that create objects (the workflow scene) delete them first, so re-runs don't show
  duplicates. Use a fresh container for the take you publish anyway.
- `demo/.out/` is gitignored. It holds the throwaway instance's API key and admin session (files
  are `0600`), so point the pipeline only at a disposable Metabase.
