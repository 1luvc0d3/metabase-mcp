import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import type { Request, Response, NextFunction } from 'express';
import type { AppConfig } from '../client/types.js';
import type { ToolContext } from '../tools/types.js';
import type { Logger } from '../config.js';
import { registerTools } from '../tools/index.js';

interface SessionEntry {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
  createdAt: Date;
}

export async function startHttpTransport(
  config: AppConfig,
  toolContext: ToolContext,
  logger: Logger
): Promise<void> {
  const httpConfig = config.http;
  const sessions = new Map<string, SessionEntry>();

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

  // Auth middleware
  if (httpConfig.authToken) {
    app.use('/mcp', (req: Request, res: Response, next: NextFunction) => {
      const authHeader = req.headers.authorization;
      if (!authHeader || authHeader !== `Bearer ${httpConfig.authToken}`) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      next();
    });
  }

  // Health endpoint
  app.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      transport: 'http',
      sessions: sessions.size,
      mode: config.mode,
    });
  });

  // Handle POST /mcp -- JSON-RPC messages
  app.post('/mcp', async (req: Request, res: Response) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    if (sessionId && sessions.has(sessionId)) {
      // Existing session
      const session = sessions.get(sessionId)!;
      await session.transport.handleRequest(req, res, req.body);
    } else if (!sessionId) {
      // New session -- create per-session McpServer
      const sessionServer = new McpServer({
        name: 'metabase-mcp',
        version: '1.0.0',
      });

      await registerTools(sessionServer, toolContext);

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
      });

      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid) {
          sessions.delete(sid);
          logger.info('Session closed', { sessionId: sid });
        }
      };

      await sessionServer.connect(transport);

      // Store session after connect (sessionId is available after handleRequest for init)
      await transport.handleRequest(req, res, req.body);

      const newSessionId = transport.sessionId;
      if (newSessionId) {
        sessions.set(newSessionId, {
          transport,
          server: sessionServer,
          createdAt: new Date(),
        });
        logger.info('New session created', { sessionId: newSessionId });
      }
    } else {
      // Invalid session ID
      res.status(404).json({ error: 'Session not found' });
    }
  });

  // Handle GET /mcp -- SSE stream
  app.get('/mcp', async (req: Request, res: Response) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    if (!sessionId || !sessions.has(sessionId)) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const session = sessions.get(sessionId)!;
    await session.transport.handleRequest(req, res);
  });

  // Handle DELETE /mcp -- session teardown
  app.delete('/mcp', async (req: Request, res: Response) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    if (!sessionId || !sessions.has(sessionId)) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const session = sessions.get(sessionId)!;
    await session.transport.close();
    await session.server.close();
    sessions.delete(sessionId);
    logger.info('Session terminated', { sessionId });
    res.status(200).json({ status: 'session closed' });
  });

  // Start listening
  app.listen(httpConfig.port, httpConfig.host, () => {
    logger.info(`MCP HTTP server listening on http://${httpConfig.host}:${httpConfig.port}`);
    logger.info('Endpoints: POST/GET/DELETE /mcp, GET /health');
  });
}
