// Shared helpers for the demo pipeline (setup → verify → record).
//
// Everything generated lands in demo/.out/ (gitignored): the MCP configs, which hold the
// throwaway instance's API key, the admin session for browser shots, reports, clips and the
// final video. Point the pipeline at a disposable Metabase container, never a real instance.

import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
export const outDir = process.env.DEMO_OUT_DIR || join(repo, 'demo', '.out');
export const statePath = join(outDir, 'state.json');
/**
 * Claude runs from an empty folder outside the repo so no project files, git info or CLAUDE.md
 * leak in. Its path shows in Claude Code's startup banner, so the default is short and has no
 * user name in it.
 */
export const stageDir =
  process.env.DEMO_STAGE_DIR || (process.platform === 'win32' ? join(tmpdir(), 'metabase-mcp-demo') : '/tmp/metabase-mcp-demo');
export const SERVER_NAME = 'metabase';

/** Server profiles a scenario can run against. Each becomes its own MCP config file. */
export const PROFILES = {
  // Full read + write toolset, audit log on (the guardrails scene shows it).
  write: { MCP_MODE: 'write' },
  // Read-only with per-tool gating: execute_query is never registered.
  locked: { MCP_MODE: 'read', MCP_TOOLS_DENY: 'execute_query' },
};

export function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Write a file only the current user can read (it may hold the throwaway API key or session). */
export function writePrivate(path, content) {
  ensureDir(dirname(path));
  writeFileSync(path, content, { mode: 0o600 });
  chmodSync(path, 0o600);
}

export function loadState() {
  if (!existsSync(statePath)) {
    throw new Error(`No demo state at ${statePath}. Run \`npm run demo:setup\` first.`);
  }
  return JSON.parse(readFileSync(statePath, 'utf8'));
}

export const mcpConfigPath = (profile) => join(outDir, `mcp-${profile}.json`);

/**
 * Flags that give Claude Code a clean, isolated session: only the demo MCP server, no built-in
 * tools, no user/project settings (so no personal hooks, permissions or CLAUDE.md), and the demo
 * server's tools pre-approved so permission prompts never interrupt a run or a take.
 */
export function claudeArgs(profile, model) {
  return [
    '--strict-mcp-config',
    '--mcp-config', mcpConfigPath(profile),
    '--setting-sources', '',
    '--tools', '',
    '--allowedTools', `mcp__${SERVER_NAME}`,
    '--model', model,
  ];
}

/** Metabase REST call with the admin session from setup. */
export async function metabaseApi(state, path, { method = 'GET', body } = {}) {
  const res = await fetch(`${state.metabaseUrl}/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Metabase-Session': state.session },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : undefined;
}

/** Find live (non-archived) items by exact name via the search API. */
export async function findByName(state, model, name) {
  const res = await metabaseApi(state, `/search?q=${encodeURIComponent(name)}&models=${model}`);
  const items = Array.isArray(res) ? res : res.data;
  return items.filter((i) => i.model === model && i.name === name && !i.archived);
}

/** Delete dashboards and cards by name so scenarios that create them can run again cleanly. */
export async function deleteByName(state, { dashboards = [], cards = [] }) {
  for (const name of dashboards) {
    for (const d of await findByName(state, 'dashboard', name)) {
      await metabaseApi(state, `/dashboard/${d.id}`, { method: 'PUT', body: { archived: true } });
      await metabaseApi(state, `/dashboard/${d.id}`, { method: 'DELETE' }).catch(() => {});
    }
  }
  for (const name of cards) {
    for (const c of await findByName(state, 'card', name)) {
      await metabaseApi(state, `/card/${c.id}`, { method: 'PUT', body: { archived: true } });
      await metabaseApi(state, `/card/${c.id}`, { method: 'DELETE' }).catch(() => {});
    }
  }
}

/** Run a command, inherit stderr, resolve with stdout. Rejects on a non-zero exit. */
export function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'inherit'], ...opts });
    let out = '';
    child.stdout?.on('data', (c) => (out += c));
    child.stderr?.on('data', (c) => (out += opts.mergeStderr ? c : ''));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`${cmd} exited with ${code}`))));
  });
}

export function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const [k, v] = a.slice(2).split('=');
    opts[k] = v ?? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true);
  }
  return opts;
}
