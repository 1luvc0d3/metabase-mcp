#!/usr/bin/env node
// End-to-end smoke test: starts the built MCP server (dist/index.js) over stdio, connects a
// real MCP client, and exercises the tools against a live Metabase. Catches what the mocked
// unit/integration tests can't: real request and response shapes for each Metabase version.
//
// Usage (after `npm run build`):
//   METABASE_URL=http://localhost:3000 npm run test:e2e
// On a fresh instance it runs the setup wizard itself (tests/e2e/metabase-setup.mjs); on one
// that's already set up, also pass E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD. The API key it
// creates stays in memory. To reuse your own key instead, pass METABASE_API_KEY and
// E2E_PARAM_CARD_ID (a native card with {{category}} text and {{min_price}} number variables).
// Optional: SERVER_ENTRY=path/to/dist/index.js to test another build (e.g. a published package).
//
// Every object the checks create is deleted again. Exits non-zero if any check fails.

import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { prepareMetabase } from './metabase-setup.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const METABASE_URL = process.env.METABASE_URL;
if (!METABASE_URL) {
  console.error('Set METABASE_URL (see the usage notes at the top of this file)');
  process.exit(2);
}
let METABASE_API_KEY = process.env.METABASE_API_KEY;
let paramCardId = Number(process.env.E2E_PARAM_CARD_ID);
const runId = Date.now();
const results = [];

async function connect(extraEnv = {}) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [process.env.SERVER_ENTRY || join(repo, 'dist', 'index.js')],
    env: {
      ...process.env,
      METABASE_URL,
      METABASE_API_KEY,
      MCP_MODE: 'write',
      LOG_LEVEL: 'error',
      ...extraEnv,
    },
    stderr: 'inherit',
  });
  const client = new Client({ name: 'metabase-mcp-e2e', version: '0.0.0' });
  await client.connect(transport);
  return client;
}

/** Call a tool; returns { ok, text, json } where json is the parsed text when it's JSON. */
async function call(client, name, args = {}) {
  try {
    const res = await client.callTool({ name, arguments: args });
    const text = (res.content ?? []).map((c) => c.text ?? '').join('\n');
    let json;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { ok: !res.isError && !(json && json.error), text, json };
  } catch (e) {
    return { ok: false, text: `threw: ${e.message}` };
  }
}

async function check(label, fn) {
  try {
    const detail = await fn();
    results.push({ label, ok: true });
    console.log(`PASS  ${label}${detail ? `  (${detail})` : ''}`);
  } catch (e) {
    results.push({ label, ok: false, error: e.message });
    console.log(`FAIL  ${label}\n      ${String(e.message).slice(0, 600)}`);
  }
}

/** Make text safe for a single markdown table cell: escape backslashes first, then pipes. */
function markdownCell(text) {
  return String(text).slice(0, 200).replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');
}

function expect(cond, message) {
  if (!cond) throw new Error(message);
}

const idOf = (r) => r.json?.id ?? Number((r.text.match(/"id":\s*(\d+)/) || [])[1]);

async function main() {
  if (!METABASE_API_KEY || !paramCardId) {
    const prepared = await prepareMetabase(METABASE_URL);
    METABASE_API_KEY = prepared.apiKey;
    paramCardId = prepared.paramCardId;
    console.log(`Prepared Metabase ${prepared.version}: fixture card ${paramCardId}`);
    process.env.E2E_LABEL ??= `Metabase ${prepared.version}`;
  }
  const client = await connect();
  let databaseId;
  let cardId;
  let dashboardId;

  try {
    await check('tools/list exposes read and write tools', async () => {
      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name);
      for (const n of ['list_databases', 'execute_query', 'execute_card', 'batch_execute', 'run_workflow',
        'create_card', 'delete_card', 'create_dashboard', 'add_card_to_dashboard', 'remove_card_from_dashboard']) {
        expect(names.includes(n), `missing tool ${n}`);
      }
      return `${tools.length} tools`;
    });

    await check('input validation rejects a string database_id', async () => {
      const r = await call(client, 'execute_query', { database_id: 'one', sql: 'SELECT 1' });
      expect(!r.ok, `expected a validation error, got: ${r.text.slice(0, 200)}`);
    });

    await check('list_databases finds the Sample Database', async () => {
      const r = await call(client, 'list_databases');
      expect(r.ok, r.text);
      const dbs = Array.isArray(r.json) ? r.json : r.json?.databases ?? r.json?.data ?? [];
      const sample = dbs.find((d) => /sample/i.test(d.name ?? ''));
      expect(sample, `no Sample Database in: ${r.text.slice(0, 300)}`);
      databaseId = sample.id;
      return `id ${databaseId}`;
    });

    await check('get_database_schema includes PRODUCTS', async () => {
      const r = await call(client, 'get_database_schema', { database_id: databaseId });
      expect(r.ok && /PRODUCTS/i.test(r.text), r.text.slice(0, 300));
    });

    await check('execute_query runs SQL', async () => {
      const r = await call(client, 'execute_query', { database_id: databaseId, sql: 'SELECT COUNT(*) AS product_count FROM PRODUCTS' });
      expect(r.ok && /product_count/i.test(r.text), r.text.slice(0, 300));
    });

    await check('SQL guardrails block a write statement', async () => {
      const r = await call(client, 'execute_query', { database_id: databaseId, sql: 'DROP TABLE PRODUCTS' });
      expect(!r.ok, `DROP was not blocked: ${r.text.slice(0, 200)}`);
    });

    await check('execute_card maps { name: value } parameters', async () => {
      const r = await call(client, 'execute_card', { card_id: paramCardId, parameters: { category: 'Gizmo', min_price: 0 } });
      expect(r.ok && /matching/i.test(r.text), r.text.slice(0, 300));
    });

    await check('execute_card matches parameters by display name', async () => {
      const r = await call(client, 'execute_card', { card_id: paramCardId, parameters: { Category: 'Widget', 'Min Price': 10 } });
      expect(r.ok && /matching/i.test(r.text), r.text.slice(0, 300));
    });

    await check('execute_card names valid parameters for an unknown key', async () => {
      const r = await call(client, 'execute_card', { card_id: paramCardId, parameters: { nope: 1 } });
      expect(!r.ok && r.text.includes('category') && r.text.includes('min_price'), r.text.slice(0, 300));
    });

    await check('create_card', async () => {
      const r = await call(client, 'create_card', { name: `e2e card ${runId}`, database_id: databaseId, sql: 'SELECT 1 AS one' });
      cardId = idOf(r);
      expect(r.ok && cardId, r.text.slice(0, 300));
      return `id ${cardId}`;
    });

    await check('execute_card without parameters', async () => {
      const r = await call(client, 'execute_card', { card_id: cardId });
      expect(r.ok && /one/i.test(r.text), r.text.slice(0, 300));
    });

    await check('create_dashboard', async () => {
      const r = await call(client, 'create_dashboard', { name: `e2e dashboard ${runId}` });
      dashboardId = idOf(r);
      expect(r.ok && dashboardId, r.text.slice(0, 300));
      return `id ${dashboardId}`;
    });

    let dashcardId;
    await check('add_card_to_dashboard', async () => {
      const r = await call(client, 'add_card_to_dashboard', { dashboard_id: dashboardId, card_id: cardId });
      expect(r.ok, r.text.slice(0, 300));
      const d = await call(client, 'get_dashboard', { dashboard_id: dashboardId });
      const dashcards = d.json?.dashcards ?? d.json?.ordered_cards ?? [];
      dashcardId = dashcards.find((dc) => dc.card_id === cardId)?.id;
      expect(dashcardId, `card not on dashboard: ${d.text.slice(0, 300)}`);
      return `dashcard ${dashcardId}`;
    });

    await check('remove_card_from_dashboard', async () => {
      const r = await call(client, 'remove_card_from_dashboard', { dashboard_id: dashboardId, dashcard_id: dashcardId });
      expect(r.ok, r.text.slice(0, 300));
      const d = await call(client, 'get_dashboard', { dashboard_id: dashboardId });
      const dashcards = d.json?.dashcards ?? d.json?.ordered_cards ?? [];
      expect(!dashcards.some((dc) => dc.card_id === cardId), 'card still on dashboard');
    });

    await check('batch_execute runs operations in parallel', async () => {
      const r = await call(client, 'batch_execute', {
        operations: [
          { tool: 'execute_query', args: { database_id: databaseId, sql: 'SELECT 2 AS two' } },
          { tool: 'execute_card', args: { card_id: paramCardId, parameters: { category: 'Doohickey', min_price: 0 } } },
        ],
      });
      expect(r.ok && /two/i.test(r.text) && /matching/i.test(r.text), r.text.slice(0, 400));
    });

    await check('run_workflow runs steps', async () => {
      const r = await call(client, 'run_workflow', {
        steps: [
          { name: 'count', tool: 'execute_query', args: { database_id: databaseId, sql: 'SELECT 3 AS three' } },
          { name: 'card', tool: 'get_card', args: { card_id: cardId } },
        ],
      });
      expect(r.ok && /three/i.test(r.text), r.text.slice(0, 400));
    });

    await check('search_content and get_collections', async () => {
      const s = await call(client, 'search_content', { query: `e2e card ${runId}` });
      expect(s.ok, s.text.slice(0, 300));
      const c = await call(client, 'get_collections');
      expect(c.ok, c.text.slice(0, 300));
    });
  } finally {
    if (dashboardId) {
      await check('delete_dashboard reports success', async () => {
        const r = await call(client, 'delete_dashboard', { dashboard_id: dashboardId });
        expect(r.ok, r.text.slice(0, 300));
      });
    }
    if (cardId) {
      await check('delete_card reports success and the card is gone', async () => {
        const r = await call(client, 'delete_card', { card_id: cardId });
        expect(r.ok, r.text.slice(0, 300));
        const g = await call(client, 'get_card', { card_id: cardId });
        expect(!g.ok, 'card still readable after delete');
      });
    }
    await client.close();
  }

  // Column redaction is applied inside the server, so it needs its own server instance.
  const redacting = await connect({ MCP_REDACT_COLUMNS: 'EMAIL', MCP_REDACT_MODE: 'mask' });
  try {
    await check('MCP_REDACT_COLUMNS masks a column in query results', async () => {
      const r = await call(redacting, 'execute_query', { database_id: databaseId, sql: 'SELECT EMAIL, NAME FROM PEOPLE LIMIT 3' });
      expect(r.ok && r.text.includes('[REDACTED]') && !/@[a-z0-9.-]+\.[a-z]{2,}/i.test(r.text), r.text.slice(0, 300));
    });
  } finally {
    await redacting.close();
  }

  const failed = results.filter((r) => !r.ok);
  const summary = `${results.length - failed.length}/${results.length} checks passed`;
  console.log(`\n${summary}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const rows = results.map((r) => `| ${r.ok ? '✅' : '❌'} | ${r.label} | ${r.ok ? '' : markdownCell(r.error ?? '')} |`);
    appendFileSync(process.env.GITHUB_STEP_SUMMARY,
      `### ${process.env.E2E_LABEL ?? 'E2E smoke'}: ${summary}\n\n| | Check | Error |\n|---|---|---|\n${rows.join('\n')}\n\n`);
  }
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
