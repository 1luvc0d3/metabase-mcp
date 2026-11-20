#!/usr/bin/env node
// Prepares a throwaway Metabase for the demo: runs the setup wizard (or logs in), creates an API
// key, and writes one MCP config per server profile plus demo/.out/state.json. Run it once per
// fresh container; verify and record reuse what it writes.
//
//   docker run -d --name metabase-mcp-demo -p 127.0.0.1:3100:3000 metabase/metabase:latest
//   npm run build
//   METABASE_URL=http://localhost:3100 npm run demo:setup
//
// Re-running it against the same instance reuses the saved key and session (DEMO_FRESH=1 to force
// a new setup). Against an instance set up some other way, pass E2E_ADMIN_EMAIL and
// E2E_ADMIN_PASSWORD. SERVER_ENTRY points the configs at another build. Nothing secret is printed.

import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { prepareMetabase } from '../tests/e2e/metabase-setup.mjs';
import { PROFILES, SERVER_NAME, ensureDir, mcpConfigPath, outDir, repo, stageDir, statePath, writePrivate } from './lib.mjs';

const metabaseUrl = (process.env.METABASE_URL || '').replace(/\/$/, '');
if (!metabaseUrl) {
  console.error('Set METABASE_URL to a throwaway Metabase (see the top of demo/setup.mjs)');
  process.exit(2);
}
const serverEntry = process.env.SERVER_ENTRY || join(repo, 'dist', 'index.js');
if (!existsSync(serverEntry)) {
  console.error(`${serverEntry} not found. Run \`npm run build\` first.`);
  process.exit(2);
}

/** Reuse the previous setup when it targets the same instance and its session still works. */
async function reusable() {
  if (process.env.DEMO_FRESH || !existsSync(statePath)) return null;
  const prev = JSON.parse(readFileSync(statePath, 'utf8'));
  if (prev.metabaseUrl !== metabaseUrl || !prev.apiKey) return null;
  const res = await fetch(`${metabaseUrl}/api/user/current`, { headers: { 'X-Metabase-Session': prev.session } }).catch(() => null);
  return res?.ok ? prev : null;
}

const prepared = (await reusable()) ?? (await prepareMetabase(metabaseUrl));
ensureDir(outDir);
ensureDir(stageDir);

for (const [profile, env] of Object.entries(PROFILES)) {
  const config = {
    mcpServers: {
      [SERVER_NAME]: {
        command: process.execPath,
        args: [serverEntry],
        env: {
          METABASE_URL: metabaseUrl,
          METABASE_API_KEY: prepared.apiKey,
          LOG_LEVEL: 'error',
          AUDIT_LOG_FILE: join(outDir, 'audit.log'),
          ...env,
        },
      },
    },
  };
  writePrivate(mcpConfigPath(profile), JSON.stringify(config, null, 2));
}

writePrivate(
  statePath,
  JSON.stringify(
    {
      metabaseUrl,
      version: prepared.version,
      databaseId: prepared.databaseId,
      session: prepared.session,
      apiKey: prepared.apiKey,
    },
    null,
    2,
  ),
);

console.log(`Metabase ${prepared.version} ready at ${metabaseUrl}`);
console.log(`MCP configs: ${Object.keys(PROFILES).map(mcpConfigPath).join(', ')}`);
console.log('Next: npm run demo:verify');
