/**
 * HTTP transport tests: drive the real Express app with the SDK's MCP client over a
 * loopback port, so auth, session ownership and per-user limits are tested end to end.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createHttpApp, type HttpApp } from '../../../src/transport/http-transport.js';
import type { AppConfig } from '../../../src/client/types.js';
import type { ToolContext } from '../../../src/tools/types.js';
import { SQLGuardrails } from '../../../src/security/sql-guardrails.js';
import { TieredRateLimiter } from '../../../src/security/rate-limiter.js';
import { AuditLogger } from '../../../src/security/audit-logger.js';
import { SchemaManager } from '../../../src/utils/schema-manager.js';
import { Logger } from '../../../src/config.js';
import { ConfigurationError } from '../../../src/utils/errors.js';
import { createMockMetabaseClient, createTestConfig } from '../../setup.js';

const ALICE = 'alice-token-0123456789';
const BOB = 'bob-token-9876543210';

function makeConfig(http: Partial<AppConfig['http']>): AppConfig {
  return {
    mode: 'read',
    transport: 'http',
    http: {
      port: 0,
      host: '127.0.0.1',
      sessionIdleMinutes: 30,
      allowUnauthenticated: false,
      ...http,
    },
  } as AppConfig;
}

function makeContext(auditFile?: string): ToolContext {
  const testConfig = createTestConfig();
  const client = createMockMetabaseClient();
  return {
    config: { mode: 'read', metabase: { maxRows: 10000 } },
    metabaseClient: client as any,
    llmService: null,
    sqlGuardrails: new SQLGuardrails(testConfig.security),
    // One read per minute, so a second call shows whether buckets are shared
    rateLimiter: new TieredRateLimiter({ read: { requestsPerMinute: 1 } }),
    auditLogger: new AuditLogger({ logFile: auditFile, alertOnHighRisk: false }),
    schemaManager: new SchemaManager(client as any),
    logger: new Logger('error'),
  };
}

describe('HTTP transport', () => {
  let httpApp: HttpApp;
  let listener: Server;
  let baseUrl: string;
  let tmp: string;
  let auditFile: string;
  const clients: Client[] = [];

  async function start(http: Partial<AppConfig['http']>) {
    httpApp = createHttpApp(makeConfig(http), makeContext(auditFile), new Logger('error'));
    listener = httpApp.app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve, reject) => {
      listener.once('listening', resolve);
      listener.once('error', reject);
    });
    baseUrl = `http://127.0.0.1:${(listener.address() as AddressInfo).port}`;
  }

  async function connect(token?: string): Promise<{ client: Client; transport: StreamableHTTPClientTransport }> {
    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
      requestInit: token ? { headers: { Authorization: `Bearer ${token}` } } : undefined,
    });
    const client = new Client({ name: 'test', version: '1.0.0' });
    await client.connect(transport);
    clients.push(client);
    return { client, transport };
  }

  async function listDashboards(client: Client) {
    const result = await client.callTool({ name: 'list_dashboards', arguments: {} });
    return { isError: !!result.isError, text: (result.content as any)[0].text as string };
  }

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'mcp-http-'));
    auditFile = join(tmp, 'audit.log');
  });

  afterEach(async () => {
    await Promise.allSettled(clients.splice(0).map(c => c.close()));
    await httpApp?.closeAll();
    if (listener) await new Promise(resolve => listener.close(resolve));
    httpApp = undefined as unknown as HttpApp;
    listener = undefined as unknown as Server;
    rmSync(tmp, { recursive: true, force: true });
  });

  describe('startup guard', () => {
    it('refuses a non-loopback host without auth', () => {
      expect(() => createHttpApp(makeConfig({ host: '0.0.0.0' }), makeContext(), new Logger('error')))
        .toThrow(ConfigurationError);
    });

    it('allows a non-loopback host when MCP_ALLOW_UNAUTHENTICATED is set', () => {
      expect(() => createHttpApp(
        makeConfig({ host: '0.0.0.0', allowUnauthenticated: true }), makeContext(), new Logger('error')
      )).not.toThrow();
    });

    it('allows a non-loopback host with tokens', () => {
      expect(() => createHttpApp(
        makeConfig({ host: '0.0.0.0', authTokens: { alice: ALICE } }), makeContext(), new Logger('error')
      )).not.toThrow();
    });
  });

  describe('authentication', () => {
    beforeEach(() => start({ authTokens: { alice: ALICE, bob: BOB } }));

    it('rejects requests without a token', async () => {
      const res = await fetch(`${baseUrl}/mcp`, { method: 'POST' });
      expect(res.status).toBe(401);
    });

    it('rejects a wrong token', async () => {
      const res = await fetch(`${baseUrl}/mcp`, {
        method: 'POST',
        headers: { Authorization: 'Bearer nope' },
      });
      expect(res.status).toBe(401);
    });

    it('accepts a named token and serves tools', async () => {
      const { client } = await connect(ALICE);
      const { tools } = await client.listTools();
      expect(tools.map(t => t.name)).toContain('list_dashboards');
    });

    it('serves /health without a token', async () => {
      const res = await fetch(`${baseUrl}/health`);
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ status: 'ok', transport: 'http' });
    });

    it('rejects a non-initialize first request', async () => {
      const res = await fetch(`${baseUrl}/mcp`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${ALICE}`,
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      });
      expect(res.status).toBe(400);
      expect(httpApp.sessions.size).toBe(0);
    });
  });

  describe('legacy MCP_AUTH_TOKEN', () => {
    beforeEach(() => start({ authToken: ALICE }));

    it('still works, as a user named "default"', async () => {
      const { client } = await connect(ALICE);
      await listDashboards(client);
      const session = [...httpApp.sessions.values()][0];
      expect(session.user).toBe('default');
    });
  });

  describe('per-user isolation', () => {
    beforeEach(() => start({ authTokens: { alice: ALICE, bob: BOB } }));

    it('gives each user their own rate-limit buckets', async () => {
      const { client: alice } = await connect(ALICE);
      const { client: bob } = await connect(BOB);

      expect((await listDashboards(alice)).isError).toBe(false);
      const second = await listDashboards(alice);
      expect(second.isError).toBe(true);
      expect(second.text).toMatch(/rate limit/i);

      // Bob is unaffected by Alice using up her bucket
      expect((await listDashboards(bob)).isError).toBe(false);
    });

    it('shares a user\'s bucket across their sessions', async () => {
      const { client: first } = await connect(ALICE);
      const { client: second } = await connect(ALICE);
      expect((await listDashboards(first)).isError).toBe(false);
      expect((await listDashboards(second)).isError).toBe(true);
    });

    it('stamps audit events with the user name', async () => {
      const { client: alice } = await connect(ALICE);
      const { client: bob } = await connect(BOB);
      await listDashboards(alice);
      await listDashboards(bob);

      const events = readFileSync(auditFile, 'utf8').trim().split('\n').map(l => JSON.parse(l));
      const listed = events.filter(e => e.action === 'list_dashboards');
      expect(listed.map(e => e.actor).sort()).toEqual(['alice', 'bob']);
    });

    it('hides a session from other users', async () => {
      const { transport } = await connect(ALICE);
      const sessionId = transport.sessionId!;

      for (const method of ['GET', 'DELETE']) {
        const res = await fetch(`${baseUrl}/mcp`, {
          method,
          headers: { Authorization: `Bearer ${BOB}`, 'mcp-session-id': sessionId },
        });
        expect(res.status).toBe(404);
      }
      expect(httpApp.sessions.has(sessionId)).toBe(true);
    });

    it('lets the owner close their session', async () => {
      const { transport } = await connect(ALICE);
      const sessionId = transport.sessionId!;
      const res = await fetch(`${baseUrl}/mcp`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${ALICE}`, 'mcp-session-id': sessionId },
      });
      expect(res.status).toBe(200);
      expect(httpApp.sessions.has(sessionId)).toBe(false);
    });
  });

  describe('idle sessions', () => {
    beforeEach(() => start({ authTokens: { alice: ALICE }, sessionIdleMinutes: 5 }));

    it('closes sessions idle past the timeout and keeps active ones', async () => {
      const { client } = await connect(ALICE);
      await listDashboards(client);
      expect(httpApp.sessions.size).toBe(1);

      expect(await httpApp.sweepIdleSessions(Date.now() + 4 * 60_000)).toBe(0);
      expect(httpApp.sessions.size).toBe(1);

      expect(await httpApp.sweepIdleSessions(Date.now() + 6 * 60_000)).toBe(1);
      expect(httpApp.sessions.size).toBe(0);
    });
  });

  describe('without auth on loopback', () => {
    beforeEach(() => start({}));

    it('serves requests and shares one bucket, as before', async () => {
      const { client: a } = await connect();
      const { client: b } = await connect();
      expect((await listDashboards(a)).isError).toBe(false);
      expect((await listDashboards(b)).isError).toBe(true);
    });
  });
});
