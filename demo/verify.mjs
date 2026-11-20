#!/usr/bin/env node
// Verifies each demo scenario through a real Claude Code session: runs `claude -p` with only
// the demo MCP server attached, parses the stream-json transcript, and checks which tools were
// called and what they returned. Unlike tests/e2e/smoke.mjs, this exercises the model's tool
// choice, so it catches tool descriptions that steer Claude wrong.
//
//   npm run demo:verify                       # all scenarios, Haiku (cheap)
//   npm run demo:verify -- --model sonnet     # the model you'll record with
//   npm run demo:verify -- --only guardrails,gating
//
// Uses your existing Claude Code login. Writes demo/.out/verify-report.md and keeps each raw
// transcript in demo/.out/transcripts/ for debugging. Exits non-zero if any scenario fails.

import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { scenarios } from './scenarios.mjs';
import { claudeArgs, ensureDir, loadState, outDir, parseArgs, stageDir, writePrivate } from './lib.mjs';

const opts = parseArgs(process.argv.slice(2));
const model = opts.model || process.env.DEMO_VERIFY_MODEL || 'haiku';
const only = opts.only ? String(opts.only).split(',') : null;
const timeoutMs = Number(opts.timeout || 240) * 1000;
const PREFIX = 'mcp__metabase__';

/** Run one prompt headlessly and return the raw stream-json lines. */
function runClaude(scenario) {
  return new Promise((resolve, reject) => {
    const args = ['-p', scenario.prompt, ...claudeArgs(scenario.profile, model),
      '--output-format', 'stream-json', '--verbose', '--no-session-persistence'];
    const child = spawn('claude', args, { cwd: ensureDir(stageDir), stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    child.stdout.on('data', (c) => (out += c));
    child.stderr.on('data', (c) => (err += c));
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0 && !out.includes('"type":"result"')) {
        reject(new Error(`claude exited with ${code}: ${err.slice(0, 400)}`));
      } else resolve(out);
    });
  });
}

/** Turn a stream-json transcript into { initTools, calls, text, cost, mcpStatus }. */
export function parseTranscript(raw) {
  const run = { initTools: [], calls: [], text: '', cost: 0, mcpStatus: 'unknown' };
  const byId = new Map();
  const toText = (content) =>
    typeof content === 'string' ? content : (content ?? []).map((p) => p.text ?? '').join('\n');
  for (const line of raw.split('\n')) {
    if (!line.trim().startsWith('{')) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg.type === 'system' && msg.subtype === 'init') {
      run.initTools = msg.tools.filter((t) => t.startsWith(PREFIX)).map((t) => t.slice(PREFIX.length));
      run.mcpStatus = msg.mcp_servers?.map((s) => `${s.name}:${s.status}`).join(',') ?? 'none';
    } else if (msg.type === 'assistant') {
      for (const part of msg.message?.content ?? []) {
        if (part.type === 'tool_use') {
          const call = { name: part.name.replace(PREFIX, ''), input: part.input, result: '', isError: false };
          byId.set(part.id, call);
          run.calls.push(call);
        }
      }
    } else if (msg.type === 'user') {
      for (const part of msg.message?.content ?? []) {
        if (part.type === 'tool_result' && byId.has(part.tool_use_id)) {
          const call = byId.get(part.tool_use_id);
          call.result = toText(part.content);
          // The server reports failures as isError results; Claude Code marks them is_error.
          call.isError = Boolean(part.is_error) || /^\s*\{\s*"error"\s*:/.test(call.result);
        }
      }
    } else if (msg.type === 'result') {
      run.text = String(msg.result ?? '');
      run.cost = msg.total_cost_usd ?? 0;
    }
  }
  return run;
}

async function main() {
  const state = loadState();
  const selected = scenarios.filter((s) => !only || only.includes(s.id));
  const transcripts = ensureDir(join(outDir, 'transcripts'));
  const rows = [];
  let totalCost = 0;

  console.log(`Verifying ${selected.length} scenario(s) with ${model} against Metabase ${state.version}\n`);
  for (const scenario of selected) {
    const started = Date.now();
    let ok = false;
    let detail = '';
    let run;
    try {
      if (scenario.before) await scenario.before(state);
      const raw = await runClaude(scenario);
      writePrivate(join(transcripts, `${scenario.id}.jsonl`), raw);
      run = parseTranscript(raw);
      totalCost += run.cost;
      if (!run.mcpStatus.includes(':connected')) throw new Error(`MCP server not connected (${run.mcpStatus})`);
      detail = (await scenario.check(run, state)) || '';
      ok = true;
    } catch (e) {
      detail = e.message;
    }
    const secs = ((Date.now() - started) / 1000).toFixed(0);
    const tools = run ? run.calls.map((c) => `${c.name}${c.isError ? '✗' : ''}`).join(' → ') : '';
    rows.push({ id: scenario.id, ok, detail, secs, tools });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${scenario.id.padEnd(11)} ${secs.padStart(4)}s  ${detail}`);
    if (tools) console.log(`      tools: ${tools}`);
  }

  const cell = (s) => String(s).replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\n/g, ' ').slice(0, 200);
  const report = [
    `# Demo verification`,
    '',
    `Model: \`${model}\` · Metabase ${state.version} · ${new Date().toISOString()} · cost ≈ $${totalCost.toFixed(3)}`,
    '',
    '| Scenario | Result | Time | Tool calls | Detail |',
    '|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.id} | ${r.ok ? '✅' : '❌'} | ${r.secs}s | ${cell(r.tools)} | ${cell(r.detail)} |`),
    '',
  ].join('\n');
  writePrivate(join(outDir, 'verify-report.md'), report);

  const failed = rows.filter((r) => !r.ok).length;
  console.log(`\n${rows.length - failed}/${rows.length} passed · cost ≈ $${totalCost.toFixed(3)} · report: ${join(outDir, 'verify-report.md')}`);
  process.exit(failed ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
