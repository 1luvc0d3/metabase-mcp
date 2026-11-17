/**
 * Passthrough mode: each caller sends their own Metabase credential, which Metabase verifies
 * when the session opens. Uses a fake client factory in place of real Metabase.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  createHttpApp, actorFor, type HttpApp, type MetabaseCredential,
} from '../../../src/transport/http-transport.js';
import type { AppConfig } from '../../../src/client/types.js';
import type { ToolContext } from '../../../src/tools/types.js';
import { SQLGuardrails } from '../../../src/security/sql-guardrails.js';
import { TieredRateLimiter } from '../../../src/security/rate-limiter.js';
import { AuditLogger } from '../../../src/security/audit-logger.js';
import { SchemaManager } from '../../../src/utils/schema-manager.js';
import { Logger } from '../../../src/config.js';
import { ConfigurationError, MetabaseError } from '../../../src/utils/errors.js';
import { createMockMetabaseClient, createTestConfig } from '../../setup.js';

const IDENTITIES: Record<string, { id: number; email: string; common_name: string }> = {
  'mb_alice': { id: 10, email: 'alice@corp.example', common_name: 'Alice A' },
  'mb_bob': { id: 11, email: 'api-key-user-1234@api-key.invalid', common_name: 'bob-key' },
  'session-carol': { id: 12, email: 'carol@corp.example', common_name: 'Carol C' },
};

function makeConfig(http: Partial<AppConfig['http']> = {}): AppConfig {
  return {
    mode: 'read',
    transport: 'http',
    metabase: { url: 'http://metabase.test', timeout: 1000, maxRows: 100 },
    http: {
      port: 0,
      host: '127.0.0.1',
      sessionIdleMinutes: 30,
      allowUnauthenticated: false,
      authMode: 'passthrough',
      ...http,
    },
  } as AppConfig;
}

describe('HTTP transport, passthrough mode', () => {
  let httpApp: HttpApp;
  let listener: Server;
  let baseUrl: string;
  let tmp: string;
  let auditFile: string;
  let factory: ReturnType<typeof vi.fn>;
  /** The fake client built for each credential value */
  let clientsByCredential: Map<string, ReturnType<typeof createMockMetabaseClient>>;
  const mcpClients: Client[] = [];
  /** Every credential check that reached (fake) Metabase */
  let verifyCalls: string[];

  function fakeClientFor(credential: MetabaseCredential) {
    const value = credential.apiKey ?? credential.sessionToken!;
    const client = createMockMetabaseClient() as any;
    client.getCurrentUser = vi.fn(async () => {
      verifyCalls.push(value);
      await new Promise(resolve => setTimeout(resolve, 10));
      if (value === 'mb_revoked') throw new MetabaseError(401, 'Unauthenticated');
      if (value === 'mb_down') throw new Error('fetch failed');
      const identity = IDENTITIES[value];
      if (!identity) throw new MetabaseError(401, 'Unauthenticated');
      return identity;
    });
    // Each user sees a different dashboard, to prove whose client served a call
    client.getDashboards = vi.fn(async () => [
      { id: 1, name: `dashboard for ${value}`, description: null, collection_id: null, archived: false },
    ]);
    clientsByCredential.set(value, client);
    return client;
  }

  function makeContext(): ToolContext {
    const testConfig = createTestConfig();
    const rootClient = createMockMetabaseClient();
    return {
      config: { mode: 'read', metabase: { maxRows: 10000 } },
      metabaseClient: rootClient as any,
      llmService: null,
      sqlGuardrails: new SQLGuardrails(testConfig.security),
      rateLimiter: new TieredRateLimiter({ read: { requestsPerMinute: 1 } }),
      auditLogger: new AuditLogger({ logFile: auditFile, alertOnHighRisk: false }),
      schemaManager: new SchemaManager(rootClient as any),
      logger: new Logger('error'),
    };
  }

  async function start(http: Partial<AppConfig['http']> = {}) {
    httpApp = createHttpApp(makeConfig(http), makeContext(), new Logger('error'), {
      createMetabaseClient: factory as any,
    });
    listener = httpApp.app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve, reject) => {
      listener.once('listening', resolve);
      listener.once('error', reject);
    });
    baseUrl = `http://127.0.0.1:${(listener.address() as AddressInfo).port}`;
  }

  async function connect(headers: Record<string, string>) {
    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
      requestInit: { headers },
    });
    const client = new Client({ name: 'test', version: '1.0.0' });
    await client.connect(transport);
    mcpClients.push(client);
    return { client, transport };
  }

  async function listDashboards(client: Client) {
    const result = await client.callTool({ name: 'list_dashboards', arguments: {} });
    return { isError: !!result.isError, text: (result.content as any)[0].text as string };
  }

  function initRequest(headers: Record<string, string>) {
    return fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        ...headers,
      },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'initialize',
        params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } },
      }),
    });
  }

  function auditEvents() {
    return readFileSync(auditFile, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
  }

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'mcp-pass-'));
    auditFile = join(tmp, 'audit.log');
    clientsByCredential = new Map();
    verifyCalls = [];
    factory = vi.fn(fakeClientFor);
  });

  afterEach(async () => {
    await Promise.allSettled(mcpClients.splice(0).map(c => c.close()));
    await httpApp?.closeAll();
    if (listener) await new Promise(resolve => listener.close(resolve));
    httpApp = undefined as unknown as HttpApp;
    listener = undefined as unknown as Server;
    rmSync(tmp, { recursive: true, force: true });
  });

  describe('startup', () => {
    it('may listen on a non-loopback host without server tokens', () => {
      expect(() => createHttpApp(
        makeConfig({ host: '0.0.0.0' }), makeContext(), new Logger('error'),
        { createMetabaseClient: factory as any }
      )).not.toThrow();
    });

    it('requires a client factory', () => {
      expect(() => createHttpApp(makeConfig(), makeContext(), new Logger('error')))
        .toThrow(ConfigurationError);
    });
  });

  describe('credentials', () => {
    beforeEach(() => start());

    it('rejects a request with no credential and names the headers', async () => {
      const res = await initRequest({});
      expect(res.status).toBe(401);
      expect((await res.json()).error).toMatch(/X-API-Key/);
      expect(factory).not.toHaveBeenCalled();
    });

    it('accepts X-API-Key', async () => {
      await connect({ 'X-API-Key': 'mb_alice' });
      expect(factory).toHaveBeenCalledWith({ apiKey: 'mb_alice' });
    });

    it('treats Authorization: Bearer as an API key', async () => {
      await connect({ Authorization: 'Bearer mb_alice' });
      expect(factory).toHaveBeenCalledWith({ apiKey: 'mb_alice' });
    });

    it('accepts X-Metabase-Session as a session token', async () => {
      await connect({ 'X-Metabase-Session': 'session-carol' });
      expect(factory).toHaveBeenCalledWith({ sessionToken: 'session-carol' });
    });

    it('answers 401 when Metabase rejects the credential, and opens no session', async () => {
      const res = await initRequest({ 'X-API-Key': 'mb_revoked' });
      expect(res.status).toBe(401);
      expect((await res.json()).error).toMatch(/rejected/);
      expect(httpApp.sessions.size).toBe(0);
      expect(httpApp.credentialContextCount()).toBe(0);
    });

    it('answers 503, not 401, when Metabase is unreachable', async () => {
      const res = await initRequest({ 'X-API-Key': 'mb_down' });
      expect(res.status).toBe(503);
      expect(httpApp.sessions.size).toBe(0);
    });
  });

  describe('per-user Metabase access', () => {
    beforeEach(() => start());

    it('serves each user through their own Metabase client', async () => {
      const { client: alice } = await connect({ 'X-API-Key': 'mb_alice' });
      const { client: bob } = await connect({ 'X-API-Key': 'mb_bob' });

      expect((await listDashboards(alice)).text).toContain('dashboard for mb_alice');
      expect((await listDashboards(bob)).text).toContain('dashboard for mb_bob');
      expect(clientsByCredential.get('mb_alice')!.getDashboards).toHaveBeenCalledTimes(1);
      expect(clientsByCredential.get('mb_bob')!.getDashboards).toHaveBeenCalledTimes(1);
    });

    it('gives each user their own rate-limit buckets', async () => {
      const { client: alice } = await connect({ 'X-API-Key': 'mb_alice' });
      const { client: bob } = await connect({ 'X-API-Key': 'mb_bob' });
      expect((await listDashboards(alice)).isError).toBe(false);
      expect((await listDashboards(alice)).isError).toBe(true);
      expect((await listDashboards(bob)).isError).toBe(false);
    });

    it('audits users by email, API keys by key name, with the Metabase user id', async () => {
      const { client: alice } = await connect({ 'X-API-Key': 'mb_alice' });
      const { client: bob } = await connect({ 'X-API-Key': 'mb_bob' });
      await listDashboards(alice);
      await listDashboards(bob);

      const events = auditEvents();
      expect(events.filter(e => e.action === 'list_dashboards').map(e => e.actor).sort())
        .toEqual(['alice@corp.example', 'api-key:bob-key']);
      const opens = events.filter(e => e.action === 'session_open');
      expect(opens.map(e => [e.actor, e.details.metabaseUserId]).sort())
        .toEqual([['alice@corp.example', 10], ['api-key:bob-key', 11]]);
    });

    it('audits a rejected credential as blocked, without the credential', async () => {
      await initRequest({ 'X-API-Key': 'mb_revoked' });
      const raw = readFileSync(auditFile, 'utf8');
      expect(raw).not.toContain('mb_revoked');
      expect(auditEvents().find(e => e.action === 'session_open')?.result).toBe('blocked');
    });

    it('binds a session to the credential that opened it', async () => {
      const { transport } = await connect({ 'X-API-Key': 'mb_alice' });
      const sessionId = transport.sessionId!;
      for (const method of ['GET', 'DELETE']) {
        const res = await fetch(`${baseUrl}/mcp`, {
          method,
          headers: { 'X-API-Key': 'mb_bob', 'mcp-session-id': sessionId },
        });
        expect(res.status).toBe(404);
      }
      // Same person, other credential type: still not the same credential
      const res = await fetch(`${baseUrl}/mcp`, {
        method: 'DELETE',
        headers: { 'X-Metabase-Session': 'mb_alice', 'mcp-session-id': sessionId },
      });
      expect(res.status).toBe(404);
      expect(httpApp.sessions.has(sessionId)).toBe(true);
    });
  });

  describe('credential contexts', () => {
    beforeEach(() => start());

    it('reuses one client for a credential\'s sessions and drops it after the last closes', async () => {
      const first = await connect({ 'X-API-Key': 'mb_alice' });
      const second = await connect({ 'X-API-Key': 'mb_alice' });
      expect(factory).toHaveBeenCalledTimes(1);
      expect(httpApp.credentialContextCount()).toBe(1);

      const close = (sessionId: string) => fetch(`${baseUrl}/mcp`, {
        method: 'DELETE',
        headers: { 'X-API-Key': 'mb_alice', 'mcp-session-id': sessionId },
      });
      await close(first.transport.sessionId!);
      expect(httpApp.credentialContextCount()).toBe(1);
      await close(second.transport.sessionId!);
      expect(httpApp.credentialContextCount()).toBe(0);
    });

    it('re-verifies the credential with Metabase on every new session', async () => {
      await connect({ 'X-API-Key': 'mb_alice' });
      await connect({ 'X-API-Key': 'mb_alice' });
      expect(clientsByCredential.get('mb_alice')!.getCurrentUser).toHaveBeenCalledTimes(2);
    });

    it('drops contexts of idle sessions', async () => {
      await connect({ 'X-API-Key': 'mb_alice' });
      await httpApp.sweepIdleSessions(Date.now() + 31 * 60_000);
      expect(httpApp.credentialContextCount()).toBe(0);
    });
  });
});

describe('actorFor()', () => {
  it('uses the email for people and the key name for API keys', () => {
    expect(actorFor({ id: 1, email: 'a@b.c', common_name: 'A' })).toBe('a@b.c');
    expect(actorFor({ id: 2, email: 'api-key-user-x@api-key.invalid', common_name: 'etl' }))
      .toBe('api-key:etl');
  });
});

describe('HTTP transport, passthrough abuse controls', () => {
  let httpApp: HttpApp;
  let listener: Server;
  let baseUrl: string;
  let verifyCalls: string[];
  let tmp: string;

  function fakeClient(credential: MetabaseCredential) {
    const value = credential.apiKey ?? credential.sessionToken!;
    const client = createMockMetabaseClient() as any;
    client.getCurrentUser = vi.fn(async () => {
      verifyCalls.push(value);
      await new Promise(resolve => setTimeout(resolve, 10));
      if (value.startsWith('mb_down')) throw new Error('fetch failed');
      const identity = IDENTITIES[value];
      if (!identity) throw new MetabaseError(401, 'Unauthenticated');
      return identity;
    });
    return client;
  }

  beforeEach(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'mcp-abuse-'));
    verifyCalls = [];
    const testConfig = createTestConfig();
    const root = createMockMetabaseClient();
    const context: ToolContext = {
      config: { mode: 'read', metabase: { maxRows: 10000 } },
      metabaseClient: root as any,
      llmService: null,
      sqlGuardrails: new SQLGuardrails(testConfig.security),
      rateLimiter: new TieredRateLimiter(),
      auditLogger: new AuditLogger({ logFile: join(tmp, 'audit.log'), alertOnHighRisk: false }),
      schemaManager: new SchemaManager(root as any),
      logger: new Logger('error'),
    };
    httpApp = createHttpApp(
      makeConfig({ authFailuresPerMinute: 3, trustProxy: true }),
      context, new Logger('error'), { createMetabaseClient: fakeClient as any }
    );
    listener = httpApp.app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve, reject) => {
      listener.once('listening', resolve);
      listener.once('error', reject);
    });
    baseUrl = `http://127.0.0.1:${(listener.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await httpApp.closeAll();
    await new Promise(resolve => listener.close(resolve));
    rmSync(tmp, { recursive: true, force: true });
  });

  function open(apiKey: string, ip = '203.0.113.1') {
    return fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'X-API-Key': apiKey,
        'X-Forwarded-For': ip,
      },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'initialize',
        params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } },
      }),
    });
  }

  it('answers a retried bad key from memory: one Metabase call, no lockout', async () => {
    for (let i = 0; i < 20; i++) {
      expect((await open('mb_bad')).status).toBe(401);
    }
    expect(verifyCalls).toEqual(['mb_bad']);
    // One counted failure, so a good key from the same IP still works
    expect((await open('mb_alice')).status).toBe(200);
  });

  it('shares one Metabase call between concurrent checks of the same key', async () => {
    const results = await Promise.all(Array.from({ length: 20 }, () => open('mb_bad')));
    expect(results.every(r => r.status === 401)).toBe(true);
    expect(verifyCalls).toEqual(['mb_bad']);
  });

  it('throttles an IP that keeps presenting fresh bad keys, without asking Metabase', async () => {
    for (const key of ['mb_bad1', 'mb_bad2', 'mb_bad3']) {
      expect((await open(key)).status).toBe(401);
    }
    const throttled = await open('mb_bad4');
    expect(throttled.status).toBe(429);
    expect(Number(throttled.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(verifyCalls).not.toContain('mb_bad4');

    // An unknown good key from the throttled IP is throttled too (the residual limitation)
    expect((await open('mb_bob')).status).toBe(429);
  });

  it('keeps the budget per client IP', async () => {
    for (const key of ['mb_bad1', 'mb_bad2', 'mb_bad3']) await open(key, '203.0.113.1');
    expect((await open('mb_bad4', '203.0.113.1')).status).toBe(429);
    expect((await open('mb_bad4', '198.51.100.7')).status).toBe(401);
  });

  it('lets a recently verified credential through a throttled IP', async () => {
    expect((await open('mb_alice')).status).toBe(200);
    for (const key of ['mb_bad1', 'mb_bad2', 'mb_bad3']) await open(key);
    expect((await open('mb_bad4')).status).toBe(429);

    // Alice still opens new sessions, and Metabase is still asked (revocation still works)
    const before = verifyCalls.filter(v => v === 'mb_alice').length;
    expect((await open('mb_alice')).status).toBe(200);
    expect(verifyCalls.filter(v => v === 'mb_alice').length).toBe(before + 1);
  });

  it('never caches or counts Metabase being unreachable', async () => {
    for (let i = 0; i < 6; i++) {
      expect((await open('mb_down')).status).toBe(503);
    }
    expect(verifyCalls.filter(v => v === 'mb_down')).toHaveLength(6);
    expect(httpApp.trackedFailureIpCount()).toBe(0);
  });

  it('forgets IPs whose failures have aged out', async () => {
    await open('mb_bad1');
    expect(httpApp.trackedFailureIpCount()).toBe(1);
    vi.useFakeTimers({ now: Date.now() + 61_000, toFake: ['Date'] });
    try {
      await httpApp.sweepIdleSessions();
      expect(httpApp.trackedFailureIpCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('passthrough abuse controls: disabled', () => {
  it('MCP_AUTH_FAILURES_PER_MINUTE=0 turns the IP budget off', async () => {
    const root = createMockMetabaseClient();
    const calls: string[] = [];
    const app = createHttpApp(
      makeConfig({ authFailuresPerMinute: 0, trustProxy: true }),
      {
        config: { mode: 'read', metabase: { maxRows: 10 } },
        metabaseClient: root as any, llmService: null,
        sqlGuardrails: new SQLGuardrails(createTestConfig().security),
        rateLimiter: new TieredRateLimiter(), auditLogger: new AuditLogger(),
        schemaManager: new SchemaManager(root as any), logger: new Logger('error'),
      },
      new Logger('error'),
      {
        createMetabaseClient: ((c: MetabaseCredential) => ({
          getCurrentUser: async () => { calls.push(c.apiKey!); throw new MetabaseError(401, 'no'); },
        })) as any,
      }
    );
    const server = app.app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
    try {
      for (let i = 0; i < 15; i++) {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'X-API-Key': `mb_x${i}` },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } }),
        });
        expect(res.status).toBe(401);
      }
      expect(calls).toHaveLength(15);
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  });
});
