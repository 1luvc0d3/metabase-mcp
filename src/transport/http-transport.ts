import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Server } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import type { Express, Request, Response, NextFunction } from 'express';
import type { AppConfig, MetabaseCurrentUser } from '../client/types.js';
import type { MetabaseClient } from '../client/metabase-client.js';
import type { ToolContext } from '../tools/types.js';
import type { Logger } from '../config.js';
import type { TieredRateLimiter } from '../security/rate-limiter.js';
import { registerTools } from '../tools/index.js';
import { SchemaManager } from '../utils/schema-manager.js';
import { ConfigurationError, MetabaseError } from '../utils/errors.js';
import { VERSION } from '../version.js';

/** Name used for requests when the server runs without auth tokens */
export const ANONYMOUS_USER = 'anonymous';

/** A caller's own Metabase credential, in passthrough mode */
export type MetabaseCredential =
  | { apiKey: string; sessionToken?: undefined }
  | { sessionToken: string; apiKey?: undefined };

export interface HttpAppOptions {
  /**
   * Builds a Metabase client for a caller's credential. Required in passthrough mode; the
   * caller wires in the column redactor so redaction applies to every user.
   */
  createMetabaseClient?: (credential: MetabaseCredential) => MetabaseClient;
}

interface SessionEntry {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
  /** What the session is bound to: token name (shared) or credential digest (passthrough) */
  principal: string;
  /** Who shows up in logs and audit events */
  user: string;
  createdAt: Date;
  lastSeen: number;
}

interface TokenEntry {
  name: string;
  digest: Buffer;
}

interface CredentialContext {
  context: ToolContext;
  sessions: number;
}

export interface HttpApp {
  app: Express;
  /** Open sessions, keyed by MCP session id */
  sessions: Map<string, SessionEntry>;
  /** Close sessions idle longer than the configured timeout; returns how many were closed */
  sweepIdleSessions(now?: number): Promise<number>;
  /** Close every session */
  closeAll(): Promise<void>;
  /** Passthrough mode: how many distinct credentials currently have a live context */
  credentialContextCount(): number;
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

/**
 * Keyed digest of a secret (server token or Metabase credential), used only in memory for
 * constant-time comparison and as a map key. The key is random per process, so a digest
 * that leaks (a heap dump, say) can't be checked against guesses, and the raw secret
 * never needs to be kept for comparison.
 */
const DIGEST_KEY = randomBytes(32);

function digest(value: string): Buffer {
  return createHmac('sha256', DIGEST_KEY).update(value).digest();
}

/**
 * Collect the configured tokens. MCP_AUTH_TOKEN is kept for compatibility as a user named
 * "default"; MCP_AUTH_TOKENS adds named users.
 */
function buildTokenTable(config: AppConfig['http']): TokenEntry[] {
  const table: TokenEntry[] = [];
  if (config.authToken && !config.authTokens?.default) {
    table.push({ name: 'default', digest: digest(config.authToken) });
  }
  for (const [name, token] of Object.entries(config.authTokens ?? {})) {
    table.push({ name, digest: digest(token) });
  }
  return table;
}

/**
 * Resolve a bearer token to a user name. Compares fixed-length digests in constant time and
 * checks every entry, so timing reveals neither the token nor which user matched.
 */
function authenticate(table: TokenEntry[], header: string | undefined): string | null {
  if (!header?.startsWith('Bearer ')) return null;
  const presented = digest(header.slice('Bearer '.length));
  let match: string | null = null;
  for (const entry of table) {
    if (timingSafeEqual(presented, entry.digest) && match === null) {
      match = entry.name;
    }
  }
  return match;
}

function singleHeader(req: Request, name: string): string | undefined {
  const value = req.headers[name];
  const first = Array.isArray(value) ? value[0] : value;
  return first?.trim() || undefined;
}

/**
 * Read the caller's Metabase credential: `X-API-Key`, then `X-Metabase-Session`, then
 * `Authorization: Bearer`, which always means an API key (for clients that can only set
 * Authorization).
 */
function readCredential(req: Request): MetabaseCredential | null {
  const apiKey = singleHeader(req, 'x-api-key');
  if (apiKey) return { apiKey };
  const sessionToken = singleHeader(req, 'x-metabase-session');
  if (sessionToken) return { sessionToken };
  const auth = singleHeader(req, 'authorization');
  if (auth?.startsWith('Bearer ')) {
    const bearer = auth.slice('Bearer '.length).trim();
    if (bearer) return { apiKey: bearer };
  }
  return null;
}

function credentialDigest(credential: MetabaseCredential): string {
  const raw = credential.apiKey !== undefined
    ? `api-key:${credential.apiKey}`
    : `session:${credential.sessionToken}`;
  return digest(raw).toString('hex');
}

/** Audit name for a Metabase user: their email, or `api-key:<key name>` for an API key */
export function actorFor(user: MetabaseCurrentUser): string {
  return user.email.endsWith('@api-key.invalid') ? `api-key:${user.common_name}` : user.email;
}

/**
 * Build the Express app for the Streamable HTTP transport, without listening.
 *
 * Shared mode: everyone uses the server's Metabase credential; named bearer tokens identify
 * users. Passthrough mode: each request carries the caller's own Metabase credential, which
 * Metabase verifies when the session opens, so Metabase permissions apply to each person.
 *
 * Either way each user gets their own rate-limit buckets and audit attribution, and a session
 * belongs to whoever opened it: other callers get the same 404 as an unknown session.
 */
export function createHttpApp(
  config: AppConfig,
  toolContext: ToolContext,
  logger: Logger,
  options: HttpAppOptions = {}
): HttpApp {
  const httpConfig = config.http;
  const passthrough = httpConfig.authMode === 'passthrough';
  const tokens = buildTokenTable(httpConfig);
  const authEnabled = passthrough || tokens.length > 0;

  if (passthrough && !options.createMetabaseClient) {
    throw new ConfigurationError(
      'Passthrough mode needs a Metabase client factory',
      'http.authMode'
    );
  }

  if (!authEnabled && !LOOPBACK_HOSTS.has(httpConfig.host) && !httpConfig.allowUnauthenticated) {
    throw new ConfigurationError(
      `Refusing to listen on ${httpConfig.host} without authentication. Set MCP_AUTH_TOKENS ` +
        '(or MCP_AUTH_TOKEN), use MCP_AUTH_MODE=passthrough, or set ' +
        'MCP_ALLOW_UNAUTHENTICATED=true if something in front of this server already ' +
        'authenticates requests.',
      'http.authTokens'
    );
  }

  const sessions = new Map<string, SessionEntry>();
  const idleMs = httpConfig.sessionIdleMinutes * 60_000;

  /** Rate-limit buckets per user, kept across sessions and reconnects */
  const limiters = new Map<string, TieredRateLimiter>();
  function limiterFor(user: string): TieredRateLimiter {
    let limiter = limiters.get(user);
    if (!limiter) {
      limiter = toolContext.rateLimiter.createSibling();
      limiters.set(user, limiter);
    }
    return limiter;
  }

  /** Shared mode: one tool context per token name */
  const userContexts = new Map<string, ToolContext>();
  function sharedContextFor(user: string): ToolContext {
    if (tokens.length === 0) return toolContext;
    let ctx = userContexts.get(user);
    if (!ctx) {
      ctx = {
        ...toolContext,
        rateLimiter: limiterFor(user),
        auditLogger: toolContext.auditLogger.withActor(user),
      };
      userContexts.set(user, ctx);
    }
    return ctx;
  }

  /**
   * Passthrough mode: one tool context per credential, holding that credential's Metabase
   * client and schema cache (what a user can see depends on their permissions, so the cache
   * can't be shared). Dropped when the credential's last session closes.
   */
  const credentialContexts = new Map<string, CredentialContext>();

  function releaseCredential(principal: string): void {
    const entry = credentialContexts.get(principal);
    if (!entry) return;
    entry.sessions -= 1;
    if (entry.sessions <= 0) credentialContexts.delete(principal);
  }

  function forgetSession(sessionId: string, reason: string): SessionEntry | undefined {
    const session = sessions.get(sessionId);
    if (!session) return undefined;
    sessions.delete(sessionId);
    if (passthrough) releaseCredential(session.principal);
    logger.info('Session closed', { sessionId, user: session.user, reason });
    return session;
  }

  async function closeSession(sessionId: string, reason: string): Promise<void> {
    const session = forgetSession(sessionId, reason);
    if (!session) return;
    await session.transport.close();
    await session.server.close();
  }

  const app = createMcpExpressApp({ host: httpConfig.host });

  // CORS middleware
  if (httpConfig.corsOrigin) {
    const allowHeaders = passthrough
      ? 'Content-Type, Authorization, mcp-session-id, X-API-Key, X-Metabase-Session'
      : 'Content-Type, Authorization, mcp-session-id';
    app.use((req: Request, res: Response, next: NextFunction) => {
      res.setHeader('Access-Control-Allow-Origin', httpConfig.corsOrigin!);
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', allowHeaders);
      res.setHeader('Access-Control-Expose-Headers', 'mcp-session-id');
      if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
      }
      next();
    });
  }

  // Auth middleware: sets res.locals.principal (what sessions bind to) and, in shared mode,
  // res.locals.user. Passthrough resolves the user from Metabase when a session opens.
  app.use('/mcp', (req: Request, res: Response, next: NextFunction) => {
    if (passthrough) {
      const credential = readCredential(req);
      if (!credential) {
        res.status(401).json({
          error: 'Send your Metabase API key as X-API-Key (or Authorization: Bearer), ' +
            'or a Metabase session token as X-Metabase-Session',
        });
        return;
      }
      res.locals.credential = credential;
      res.locals.principal = credentialDigest(credential);
      next();
      return;
    }
    if (tokens.length === 0) {
      res.locals.user = ANONYMOUS_USER;
      res.locals.principal = ANONYMOUS_USER;
      next();
      return;
    }
    const user = authenticate(tokens, req.headers.authorization);
    if (!user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    res.locals.user = user;
    res.locals.principal = user;
    next();
  });

  // Health endpoint (unauthenticated, for container health checks)
  app.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      transport: 'http',
      authMode: httpConfig.authMode,
      version: VERSION,
      sessions: sessions.size,
      mode: config.mode,
    });
  });

  /** The caller's session, or null when it doesn't exist or belongs to someone else */
  function ownSession(req: Request, res: Response): SessionEntry | null {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    const session = sessionId ? sessions.get(sessionId) : undefined;
    // Another caller's session id gets the same 404 as an unknown one
    if (!session || session.principal !== res.locals.principal) return null;
    session.lastSeen = Date.now();
    return session;
  }

  /**
   * Passthrough: verify the credential with Metabase and build (or reuse) its context.
   * Sends the error response itself and returns null when the credential can't be used.
   */
  async function resolvePassthrough(
    res: Response
  ): Promise<{ user: string; context: ToolContext; metabaseUserId: number } | null> {
    const credential = res.locals.credential as MetabaseCredential;
    const principal = res.locals.principal as string;
    const existing = credentialContexts.get(principal);
    const client = existing?.context.metabaseClient ?? options.createMetabaseClient!(credential);

    let identity: MetabaseCurrentUser;
    try {
      identity = await client.getCurrentUser();
    } catch (error) {
      if (error instanceof MetabaseError && (error.statusCode === 401 || error.statusCode === 403)) {
        toolContext.auditLogger.logBlocked('session_open', 'Metabase rejected the credential', {
          authMode: 'passthrough',
        });
        res.status(401).json({ error: 'Metabase rejected the credential' });
      } else {
        logger.warn('Could not verify a credential with Metabase', { error: String(error) });
        res.status(503).json({ error: 'Could not reach Metabase to verify the credential' });
      }
      return null;
    }

    const user = actorFor(identity);
    const context = existing?.context ?? {
      ...toolContext,
      metabaseClient: client,
      schemaManager: new SchemaManager(client),
      rateLimiter: limiterFor(user),
      auditLogger: toolContext.auditLogger.withActor(user),
    };
    return { user, context, metabaseUserId: identity.id };
  }

  // Handle POST /mcp -- JSON-RPC messages
  app.post('/mcp', async (req: Request, res: Response) => {
    if (req.headers['mcp-session-id']) {
      const session = ownSession(req, res);
      if (!session) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }
      await session.transport.handleRequest(req, res, req.body);
      return;
    }

    if (!isInitializeRequest(req.body)) {
      res.status(400).json({ error: 'No session: the first request must be initialize' });
      return;
    }

    const principal = res.locals.principal as string;
    let user: string;
    let context: ToolContext;
    let metabaseUserId: number | undefined;
    if (passthrough) {
      const resolved = await resolvePassthrough(res);
      if (!resolved) return;
      ({ user, context, metabaseUserId } = resolved);
    } else {
      user = res.locals.user as string;
      context = sharedContextFor(user);
    }

    // New session -- a per-session McpServer bound to the caller's context
    const sessionServer = new McpServer({ name: 'metabase-mcp', version: VERSION });
    await registerTools(sessionServer, context);

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sessionId: string) => {
        if (passthrough) {
          const entry = credentialContexts.get(principal);
          if (entry) entry.sessions += 1;
          else credentialContexts.set(principal, { context, sessions: 1 });
        }
        sessions.set(sessionId, {
          transport,
          server: sessionServer,
          principal,
          user,
          createdAt: new Date(),
          lastSeen: Date.now(),
        });
        context.auditLogger.logSuccess('session_open', {
          authMode: httpConfig.authMode,
          ...(metabaseUserId !== undefined ? { metabaseUserId } : {}),
        });
        logger.info('New session created', { sessionId, user });
      },
    });

    transport.onclose = () => {
      if (transport.sessionId) forgetSession(transport.sessionId, 'transport closed');
    };

    await sessionServer.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  // Handle GET /mcp -- SSE stream
  app.get('/mcp', async (req: Request, res: Response) => {
    const session = ownSession(req, res);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    await session.transport.handleRequest(req, res);
  });

  // Handle DELETE /mcp -- session teardown
  app.delete('/mcp', async (req: Request, res: Response) => {
    const session = ownSession(req, res);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    await closeSession(req.headers['mcp-session-id'] as string, 'client request');
    res.status(200).json({ status: 'session closed' });
  });

  return {
    app,
    sessions,
    async sweepIdleSessions(now = Date.now()) {
      const idle = [...sessions.entries()]
        .filter(([, s]) => now - s.lastSeen > idleMs)
        .map(([id]) => id);
      for (const id of idle) {
        await closeSession(id, 'idle timeout');
      }
      return idle.length;
    },
    async closeAll() {
      for (const id of [...sessions.keys()]) {
        await closeSession(id, 'server shutdown');
      }
    },
    credentialContextCount() {
      return credentialContexts.size;
    },
  };
}

export async function startHttpTransport(
  config: AppConfig,
  toolContext: ToolContext,
  logger: Logger,
  options: HttpAppOptions = {}
): Promise<Server> {
  const httpConfig = config.http;
  const httpApp = createHttpApp(config, toolContext, logger, options);

  // Sweep idle sessions at most once a minute; unref so it never keeps the process alive
  const sweepEveryMs = Math.min(60_000, httpConfig.sessionIdleMinutes * 60_000);
  const sweeper = setInterval(() => {
    httpApp.sweepIdleSessions().catch(err =>
      logger.warn('Idle session sweep failed', { error: String(err) })
    );
  }, sweepEveryMs);
  sweeper.unref();

  const users = [
    ...(httpConfig.authToken && !httpConfig.authTokens?.default ? ['default'] : []),
    ...Object.keys(httpConfig.authTokens ?? {}),
  ];

  const listener = httpApp.app.listen(httpConfig.port, httpConfig.host, () => {
    logger.info(`MCP HTTP server listening on http://${httpConfig.host}:${httpConfig.port}`);
    logger.info('Endpoints: POST/GET/DELETE /mcp, GET /health');
    if (httpConfig.authMode === 'passthrough') {
      logger.info('Passthrough auth: each user sends their own Metabase credential', {
        sessionIdleMinutes: httpConfig.sessionIdleMinutes,
      });
    } else {
      logger.info(
        users.length ? 'Bearer auth enabled' : 'Bearer auth DISABLED',
        { users, sessionIdleMinutes: httpConfig.sessionIdleMinutes }
      );
    }
  });

  // Close sessions cleanly on container stop
  const shutdown = (signal: string) => {
    logger.info(`Received ${signal}, shutting down`);
    clearInterval(sweeper);
    listener.close();
    httpApp.closeAll().finally(() => process.exit(0));
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));

  return listener;
}
