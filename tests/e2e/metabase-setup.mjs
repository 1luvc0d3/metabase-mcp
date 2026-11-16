// Prepares a Metabase instance for the end-to-end smoke test (tests/e2e/smoke.mjs imports it).
//
// Fresh instance (e.g. a new Docker container): completes the setup wizard with a throwaway
// admin. Existing instance: logs in with E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD.
// Then creates an admin API key and a native "fixture" card with SQL variables
// ({{category}} text, {{min_price}} number).
//
// The API key is returned in memory and never printed or written to disk.
// Works against Metabase v0.50+ (API keys need v0.49+). Needs Node >= 20 (global fetch).

import { randomBytes } from 'node:crypto';

const healthTimeoutMs = Number(process.env.E2E_HEALTH_TIMEOUT_MS || 600_000);
let base;

async function api(path, { method = 'GET', session, body } = {}) {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(session ? { 'X-Metabase-Session': session } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : undefined;
}

async function waitForHealth() {
  const deadline = Date.now() + healthTimeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/api/health`);
      last = await res.text();
      if (res.ok && last.includes('"ok"')) return;
    } catch (e) {
      last = e.message;
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error(`Metabase at ${base} not healthy after ${healthTimeoutMs / 1000}s (last: ${last})`);
}

async function getSession() {
  const props = await api('/session/properties');
  const version = props.version?.tag ?? 'unknown';
  const token = props['setup-token'];
  const alreadySetUp = props['has-user-setup'] ?? !token;

  if (!alreadySetUp && token) {
    const email = `e2e-${Date.now()}@example.com`;
    const password = `E2e-${randomBytes(12).toString('hex')}!`;
    const res = await api('/setup', {
      method: 'POST',
      body: {
        token,
        user: { first_name: 'E2E', last_name: 'Admin', email, password, site_name: 'metabase-mcp e2e' },
        prefs: { site_name: 'metabase-mcp e2e', site_locale: 'en', allow_tracking: false },
      },
    });
    return { session: res.id, version };
  }

  const email = process.env.E2E_ADMIN_EMAIL;
  const password = process.env.E2E_ADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error('Metabase is already set up: set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD to log in');
  }
  const res = await api('/session', { method: 'POST', body: { username: email, password } });
  return { session: res.id, version };
}

async function sampleDatabaseId(session) {
  // The Sample Database is created on startup but can take a moment to sync.
  for (let i = 0; i < 24; i++) {
    const res = await api('/database', { session });
    const dbs = Array.isArray(res) ? res : res.data;
    const sample = dbs.find((d) => d.is_sample) ?? dbs.find((d) => /sample/i.test(d.name));
    if (sample) return sample.id;
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error('Sample Database not found');
}

/**
 * @param {string} metabaseUrl
 * @returns {Promise<{ apiKey: string, paramCardId: number, databaseId: number, version: string }>}
 */
export async function prepareMetabase(metabaseUrl) {
  base = metabaseUrl.replace(/\/$/, '');
  await waitForHealth();
  const { session, version } = await getSession();

  // Group 2 is the built-in Administrators group.
  const key = await api('/api-key', {
    method: 'POST',
    session,
    body: { name: `metabase-mcp e2e ${Date.now()}`, group_id: 2 },
  });

  const databaseId = await sampleDatabaseId(session);
  const card = await api('/card', {
    method: 'POST',
    session,
    body: {
      name: 'metabase-mcp e2e: parameter fixture',
      display: 'table',
      visualization_settings: {},
      dataset_query: {
        type: 'native',
        database: databaseId,
        native: {
          query: 'SELECT COUNT(*) AS matching FROM PRODUCTS WHERE CATEGORY = {{category}} AND PRICE >= {{min_price}}',
          'template-tags': {
            category: { id: 'e2e00000-0000-4000-8000-000000000001', name: 'category', 'display-name': 'Category', type: 'text' },
            min_price: { id: 'e2e00000-0000-4000-8000-000000000002', name: 'min_price', 'display-name': 'Min Price', type: 'number' },
          },
        },
      },
    },
  });

  return { apiKey: key.unmasked_key, paramCardId: card.id, databaseId, version };
}
