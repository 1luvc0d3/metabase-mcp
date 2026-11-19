// Demo scenarios: one per feature worth showing. The same list drives verification
// (`npm run demo:verify`) and recording (`npm run demo:record`), in this order.
//
// Each scenario:
//   id, title, caption  – used for the clip file name and the title card before it
//   profile             – server profile from lib.mjs PROFILES
//   prompt              – what gets typed into Claude Code
//   before(state)       – optional reset so the scenario can run repeatedly
//   check(run, state)   – throws if the feature didn't work; returns a short detail string.
//                         `run` = { initTools, calls: [{ name, input, result, isError }], text }
//                         Checks look at tool calls and results, never at Claude's wording,
//                         which changes from run to run.
//   browserShot         – optional: after the take, record this Metabase page in the browser

import { deleteByName, findByName, metabaseApi } from './lib.mjs';

function expect(cond, message) {
  if (!cond) throw new Error(message);
}

const succeeded = (run, ...names) => run.calls.filter((c) => names.includes(c.name) && !c.isError);
const callsMentioning = (run, tool) =>
  run.calls.filter((c) => c.name === tool || JSON.stringify(c.input).includes(tool));

const GROWTH = { dashboards: ['Growth'], cards: ['Orders per Month'] };

export const scenarios = [
  {
    id: 'explore',
    title: 'Ask a question',
    caption: 'Claude finds the data and runs read-only SQL through Metabase',
    profile: 'write',
    prompt: 'How many orders are in the Metabase sample database for each product category? Show a short table.',
    check(run) {
      const sql = succeeded(run, 'execute_query', 'batch_execute', 'run_workflow');
      expect(sql.length > 0, `no successful query call (calls: ${run.calls.map((c) => c.name).join(', ') || 'none'})`);
      expect(
        sql.some((c) => /gizmo|widget|gadget|doohickey/i.test(c.result)),
        'query results never mention a product category',
      );
      return `${run.calls.length} tool calls`;
    },
  },
  {
    id: 'workflow',
    title: 'Build a dashboard',
    caption: 'One workflow call: create a chart, a dashboard, and wire them together',
    profile: 'write',
    prompt:
      "In one run_workflow call: create a line-chart card called 'Orders per Month' from the sample database " +
      "showing order counts per month, create a dashboard called 'Growth', and add the card to it.",
    before: (state) => deleteByName(state, GROWTH),
    async check(run, state) {
      const wf = succeeded(run, 'run_workflow');
      expect(wf.length > 0, `run_workflow did not succeed (calls: ${run.calls.map((c) => `${c.name}${c.isError ? '!' : ''}`).join(', ')})`);
      expect(wf.some((c) => /"completed"\s*:\s*true/.test(c.result)), 'workflow did not report completed: true');
      const [dash] = await findByName(state, 'dashboard', 'Growth');
      expect(dash, "no 'Growth' dashboard in Metabase");
      const full = await metabaseApi(state, `/dashboard/${dash.id}`);
      const cards = full.dashcards ?? full.ordered_cards ?? [];
      const dashcard = cards.find((dc) => dc.card?.name === 'Orders per Month');
      expect(dashcard, "'Orders per Month' is not on the dashboard");
      // create_card saves SQL without running it, so a card can "succeed" and still be broken
      // (e.g. DATE_TRUNC on the SQLite sample database). Run it the way the dashboard will.
      const result = await metabaseApi(state, `/card/${dashcard.card.id}/query`, { method: 'POST' }).catch((e) => ({
        error: e.message.replace(/^.*?"error":"([^"]+)".*$/s, '$1'),
      }));
      expect(!result.error && result.status === 'completed', `the card's query fails in Metabase: ${String(result.error).slice(0, 160)}`);
      expect(result.row_count > 0, "the card's query returns no rows");
      return `dashboard ${dash.id}, card returns ${result.row_count} rows`;
    },
    browserShot: async (state) => {
      const [dash] = await findByName(state, 'dashboard', 'Growth');
      return dash && `/dashboard/${dash.id}`;
    },
  },
  {
    id: 'guardrails',
    title: 'SQL guardrails',
    caption: 'Destructive SQL is blocked before it ever reaches your database',
    profile: 'write',
    prompt: 'Run this on the sample database so I can see what the guardrails do: DROP TABLE PRODUCTS',
    check(run) {
      const drops = run.calls.filter((c) => c.name === 'execute_query' && /drop/i.test(JSON.stringify(c.input)));
      expect(drops.length > 0, 'Claude never sent the DROP to execute_query, so the guardrail was not exercised');
      expect(drops.every((c) => c.isError && /blocked/i.test(c.result)), `DROP was not blocked: ${drops[0].result.slice(0, 200)}`);
      return 'blocked';
    },
  },
  {
    id: 'gating',
    title: 'Per-tool gating',
    caption: 'MCP_TOOLS_DENY=execute_query: the tool simply is not there',
    profile: 'locked',
    prompt: 'Run this SQL against the sample database: SELECT * FROM ORDERS LIMIT 10',
    check(run) {
      expect(run.initTools.length > 0, 'server exposed no tools');
      expect(!run.initTools.includes('execute_query'), 'execute_query is still exposed');
      // Claude may try to route around the gate through batch_execute or run_workflow. That's
      // fine as long as the server refuses the nested operation.
      const refused = /disabled by server policy|no such tool/i;
      const leaked = callsMentioning(run, 'execute_query').filter((c) => !c.isError && !refused.test(c.result));
      expect(leaked.length === 0, `execute_query was reached through ${leaked.map((c) => c.name).join(', ')}`);
      return `${run.initTools.length} tools exposed, execute_query absent`;
    },
  },
];
