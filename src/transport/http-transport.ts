import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Server } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import type { Express, Request, Response, NextFunction } from 'express';
import type { AppConfig } from '../client/types.js';
import type { ToolContext } from '../tools/types.js';
import type { Logger } from '../config.js';
import { registerTools } from '../tools/index.js';
import { ConfigurationError } from '../utils/errors.js';
import { VERSION } from '../version.js';

/** Name used for requests when the server runs without auth tokens */
export const ANONYMOUS_USER = 'anonymous';

interface SessionEntry {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
  user: string;
  createdAt: Date;
  lastSeen: number;
}

interface TokenEntry {
  name: string;
  digest: Buffer;
}

export interface HttpApp {
  app: Express;
  /** Open sessions, keyed by MCP session id */
  sessions: Map<string, SessionEntry>;
  /** Close sessions idle longer than the configured timeout; returns how many were closed */
  sweepIdleSessions(now?: number): Promise<number>;
  /** Close every session */
  closeAll(): Promise<void>;
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
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

/**
 * Build the Express app for the Streamable HTTP transport, without listening.
 *
 * Each authenticated user gets their own rate-limit buckets and an audit logger that stamps
 * their name on every event. Sessions belong to the user who opened them: another user's
 * token can't read from or close them.
 */
export function createHttpApp(
  config: AppConfig,
  toolContext: ToolContext,
  logger: Logger
): HttpApp {
  const httpConfig = config.http;
  const tokens = buildTokenTable(httpConfig);
  const authEnabled = tokens.length > 0;

  if (!authEnabled && !LOOPBACK_HOSTS.has(httpConfig.host) && !httpConfig.allowUnauthenticated) {
    throw new ConfigurationError(
      `Refusing to listen on ${httpConfig.host} without authentication. Set MCP_AUTH_TOKENS ` +
        '(or MCP_AUTH_TOKEN), or set MCP_ALLOW_UNAUTHENTICATED=true if something in front of ' +
        'this server already authenticates requests.',
      'http.authTokens'
    );
  }

  const sessions = new Map<string, SessionEntry>();
  const userContexts = new Map<string, ToolContext>();
  const idleMs = httpConfig.sessionIdleMinutes * 60_000;

  /** Per-user tool context: own rate-limit buckets and audit attribution */
  function contextFor(user: string): ToolContext {
    if (!authEnabled) return toolContext;
    let ctx = userContexts.get(user);
    if (!ctx) {
      ctx = {
        ...toolContext,
        rateLimiter: toolContext.rateLimiter.createSibling(),
        auditLogger: toolContext.auditLogger.withActor(user),
      };
      userContexts.set(user, ctx);
    }
    return ctx;
  }

  async function closeSession(sessionId: string, reason: string): Promise<void> {
    const session = sessions.get(sessionId);
    if (!session) return;
    sessions.delete(sessionId);
    await session.transport.close();
    await session.server.close();
    logger.info('Session closed', { sessionId, user: session.user, reason });
  }

  const app = createMcpExpressApp({ host: httpConfig.host });

  // CORS middleware
  if (httpConfig.corsOrigin) {
    app.use((req: Request, res: Response, next: NextFunction) => {
      res.setHeader('Access-Control-Allow-Origin', httpConfig.corsOrigin!);
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, mcp-session-id');
      res.setHeader('Access-Control-Expose-Headers', 'mcp-session-id');
      if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
      }
      next();
    });
  }

  // Auth middleware: resolves the caller to a user name in res.locals.user
  app.use('/mcp', (req: Request, res: Response, next: NextFunction) => {
    if (!authEnabled) {
      res.locals.user = ANONYMOUS_USER;
      next();
      return;
    }
    const user = authenticate(tokens, req.headers.authorization);
    if (!user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    res.locals.user = user;
    next();
  });

  // Health endpoint (unauthenticated, for container health checks)
  app.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      transport: 'http',
      version: VERSION,
      sessions: sessions.size,
      mode: config.mode,
    });
  });

  /** The caller's session, or null when it doesn't exist or belongs to someone else */
  function ownSession(req: Request, res: Response): SessionEntry | null {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    const session = sessionId ? sessions.get(sessionId) : undefined;
    // Another user's session id gets the same 404 as an unknown one
    if (!session || session.user !== res.locals.user) return null;
    session.lastSeen = Date.now();
    return session;
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

    // New session -- create a per-session McpServer bound to the caller's context
    const user = res.locals.user as string;
    const sessionServer = new McpServer({ name: 'metabase-mcp', version: VERSION });
    await registerTools(sessionServer, contextFor(user));

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sessionId: string) => {
        sessions.set(sessionId, {
          transport,
          server: sessionServer,
          user,
          createdAt: new Date(),
          lastSeen: Date.now(),
        });
        logger.info('New session created', { sessionId, user });
      },
    });

    transport.onclose = () => {
      const sid = transport.sessionId;
      if (sid && sessions.delete(sid)) {
        logger.info('Session closed', { sessionId: sid, user, reason: 'transport closed' });
      }
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
  };
}

export async function startHttpTransport(
  config: AppConfig,
  toolContext: ToolContext,
  logger: Logger
): Promise<Server> {
  const httpConfig = config.http;
  const httpApp = createHttpApp(config, toolContext, logger);

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
    logger.info(
      users.length ? 'Bearer auth enabled' : 'Bearer auth DISABLED',
      { users, sessionIdleMinutes: httpConfig.sessionIdleMinutes }
    );
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
