/**
 * Batch Tools Integration Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerBatchTools } from '../../src/tools/batch-tools.js';
import type { ToolContext } from '../../src/tools/types.js';
import { SQLGuardrails } from '../../src/security/sql-guardrails.js';
import { TieredRateLimiter } from '../../src/security/rate-limiter.js';
import { AuditLogger } from '../../src/security/audit-logger.js';
import { SchemaManager } from '../../src/utils/schema-manager.js';
import { Logger } from '../../src/config.js';
import { createMockMetabaseClient, createTestConfig } from '../setup.js';
import {
  sampleDashboards,
  sampleCards,
  sampleDatabases,
  sampleCollections,
  sampleQueryResult,
} from '../fixtures/index.js';

describe('Batch Tools Integration', () => {
  let server: McpServer;
  let mockClient: ReturnType<typeof createMockMetabaseClient>;
  let context: ToolContext;
  let registeredTools: Map<string, any>;

  beforeEach(() => {
    server = new McpServer({ name: 'test', version: '1.0.0' });
    mockClient = createMockMetabaseClient();

    mockClient.getDashboards.mockResolvedValue(sampleDashboards);
    mockClient.getDashboard.mockResolvedValue(sampleDashboards[0]);
    mockClient.getCards.mockResolvedValue(sampleCards);
    mockClient.getCard.mockResolvedValue(sampleCards[0]);
    mockClient.executeCard.mockResolvedValue(sampleQueryResult);
    mockClient.getDatabases.mockResolvedValue(sampleDatabases);
    mockClient.executeQuery.mockResolvedValue(sampleQueryResult);
    mockClient.getCollections.mockResolvedValue(sampleCollections);
    mockClient.search.mockResolvedValue([]);

    const config = createTestConfig();

    context = {
      config,
      metabaseClient: mockClient as any,
      llmService: null,
      sqlGuardrails: new SQLGuardrails(config.security),
      rateLimiter: new TieredRateLimiter(),
      auditLogger: new AuditLogger(),
      schemaManager: new SchemaManager(mockClient as any),
      logger: new Logger('error'),
    };

    registeredTools = new Map();
    const originalTool = server.tool.bind(server);
    vi.spyOn(server, 'tool').mockImplementation((name: string, ...args: any[]) => {
      const handler = args[args.length - 1];
      registeredTools.set(name, { args, handler });
      return originalTool(name, ...args);
    });

    registerBatchTools(server, context);
  });

  describe('batch_execute', () => {
    it('registers the tool', () => {
      expect(registeredTools.has('batch_execute')).toBe(true);
    });

    it('executes multiple operations in parallel', async () => {
      const handler = registeredTools.get('batch_execute')?.handler;
      const result = await handler({
        operations: [
          { tool: 'list_dashboards' },
          { tool: 'list_databases' },
        ],
      });

      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0].text);
      expect(data.total).toBe(2);
      expect(data.succeeded).toBe(2);
      expect(data.failed).toBe(0);
      expect(data.results).toHaveLength(2);
    });

    it('executes get_dashboard by ID', async () => {
      const handler = registeredTools.get('batch_execute')?.handler;
      const result = await handler({
        operations: [
          { tool: 'get_dashboard', args: { dashboard_id: 1 } },
          { tool: 'get_card', args: { card_id: 1 } },
        ],
      });

      const data = JSON.parse(result.content[0].text);
      expect(data.succeeded).toBe(2);
      expect(mockClient.getDashboard).toHaveBeenCalledWith(1);
      expect(mockClient.getCard).toHaveBeenCalledWith(1);
    });

    it('handles partial failures gracefully', async () => {
      mockClient.getDashboard.mockRejectedValueOnce(new Error('Not found'));

      const handler = registeredTools.get('batch_execute')?.handler;
      const result = await handler({
        operations: [
          { tool: 'get_dashboard', args: { dashboard_id: 999 } },
          { tool: 'list_databases' },
        ],
      });

      const data = JSON.parse(result.content[0].text);
      expect(data.total).toBe(2);
      expect(data.succeeded).toBe(1);
      expect(data.failed).toBe(1);
      expect(data.results[0].success).toBe(false);
      expect(data.results[0].error).toBe('Not found');
      expect(data.results[1].success).toBe(true);
    });

    it('executes SQL queries with validation', async () => {
      const handler = registeredTools.get('batch_execute')?.handler;
      const result = await handler({
        operations: [
          { tool: 'execute_query', args: { database_id: 1, sql: 'SELECT * FROM users' } },
        ],
      });

      const data = JSON.parse(result.content[0].text);
      expect(data.succeeded).toBe(1);
    });

    it('rejects dangerous SQL in batch', async () => {
      const handler = registeredTools.get('batch_execute')?.handler;
      const result = await handler({
        operations: [
          { tool: 'execute_query', args: { database_id: 1, sql: 'DROP TABLE users' } },
        ],
      });

      const data = JSON.parse(result.content[0].text);
      expect(data.succeeded).toBe(0);
      expect(data.failed).toBe(1);
      expect(data.results[0].error).toContain('SQL validation failed');
    });

    it('executes search_content operations', async () => {
      mockClient.search.mockResolvedValue([
        { id: 1, name: 'Revenue', description: null, model: 'card', collection_id: 1, collection_name: 'Analytics' },
      ]);

      const handler = registeredTools.get('batch_execute')?.handler;
      const result = await handler({
        operations: [
          { tool: 'search_content', args: { query: 'revenue' } },
        ],
      });

      const data = JSON.parse(result.content[0].text);
      expect(data.succeeded).toBe(1);
      expect(data.results[0].result.count).toBe(1);
    });

    it('returns compact JSON responses', async () => {
      const handler = registeredTools.get('batch_execute')?.handler;
      const result = await handler({
        operations: [{ tool: 'list_dashboards' }],
      });

      // Compact = no indentation
      expect(result.content[0].text).not.toContain('\n');
    });

    it('includes timing information', async () => {
      const handler = registeredTools.get('batch_execute')?.handler;
      const result = await handler({
        operations: [{ tool: 'list_dashboards' }],
      });

      const data = JSON.parse(result.content[0].text);
      expect(data.duration_ms).toBeDefined();
      expect(typeof data.duration_ms).toBe('number');
    });
  });
});
