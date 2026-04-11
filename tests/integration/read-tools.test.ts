/**
 * Read Tools Integration Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerReadTools } from '../../src/tools/read-tools.js';
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
  sampleDatabaseMetadata,
  largeQueryResult,
} from '../fixtures/index.js';

describe('Read Tools Integration', () => {
  let server: McpServer;
  let mockClient: ReturnType<typeof createMockMetabaseClient>;
  let context: ToolContext;
  let registeredTools: Map<string, any>;

  beforeEach(() => {
    server = new McpServer({ name: 'test', version: '1.0.0' });
    mockClient = createMockMetabaseClient();

    // Override mock responses with fixtures
    mockClient.getDashboards.mockResolvedValue(sampleDashboards);
    mockClient.getDashboard.mockResolvedValue(sampleDashboards[0]);
    mockClient.getCards.mockResolvedValue(sampleCards);
    mockClient.getCard.mockResolvedValue(sampleCards[0]);
    mockClient.executeCard.mockResolvedValue(sampleQueryResult);
    mockClient.getDatabases.mockResolvedValue(sampleDatabases);
    mockClient.getDatabaseSchema.mockResolvedValue(sampleDatabaseMetadata);
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

    // Capture registered tools
    registeredTools = new Map();
    const originalTool = server.tool.bind(server);
    vi.spyOn(server, 'tool').mockImplementation((name: string, ...args: any[]) => {
      registeredTools.set(name, args);
      return originalTool(name, ...args);
    });

    registerReadTools(server, context);
  });

  describe('list_dashboards', () => {
    it('registers the tool', () => {
      expect(registeredTools.has('list_dashboards')).toBe(true);
    });

    it('returns list of dashboards', async () => {
      const handler = registeredTools.get('list_dashboards')?.[2];
      const result = await handler({});

      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0].text);
      expect(data.count).toBe(3);
      expect(data.dashboards).toHaveLength(3);
      expect(data.dashboards[0].name).toBe('Sales Overview');
    });

    it('respects rate limiting', async () => {
      const handler = registeredTools.get('list_dashboards')?.[2];

      // Fill up rate limit
      for (let i = 0; i < 120; i++) {
        context.rateLimiter.checkLimit('read');
      }

      const result = await handler({});
      expect(result.isError).toBe(true);
    });
  });

  describe('get_dashboard', () => {
    it('returns dashboard with cards', async () => {
      const handler = registeredTools.get('get_dashboard')?.[2];
      const result = await handler({ dashboard_id: 1 });

      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0].text);
      expect(data.id).toBe(1);
      expect(data.name).toBe('Sales Overview');
      expect(data.dashcards).toHaveLength(2);
    });

    it('calls Metabase client with correct ID', async () => {
      const handler = registeredTools.get('get_dashboard')?.[2];
      await handler({ dashboard_id: 42 });

      expect(mockClient.getDashboard).toHaveBeenCalledWith(42);
    });
  });

  describe('list_cards', () => {
    it('returns list of cards', async () => {
      const handler = registeredTools.get('list_cards')?.[2];
      const result = await handler({});

      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0].text);
      expect(data.count).toBe(3);
      expect(data.cards).toHaveLength(3);
    });
  });

  describe('get_card', () => {
    it('returns card details', async () => {
      const handler = registeredTools.get('get_card')?.[2];
      const result = await handler({ card_id: 1 });

      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0].text);
      expect(data.name).toBe('Monthly Revenue');
      expect(data.display).toBe('line');
    });
  });

  describe('execute_card', () => {
    it('executes card and returns results', async () => {
      const handler = registeredTools.get('execute_card')?.[2];
      const result = await handler({ card_id: 1 });

      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0].text);
      expect(data.columns).toBeDefined();
      expect(data.rows).toBeDefined();
      expect(data.row_count).toBe(3);
    });

    it('passes parameters to Metabase', async () => {
      const handler = registeredTools.get('execute_card')?.[2];
      await handler({ card_id: 1, parameters: { date: '2024-01-01' } });

      expect(mockClient.executeCard).toHaveBeenCalledWith(1, { date: '2024-01-01' });
    });

    it('truncates results exceeding maxRows', async () => {
      mockClient.executeCard.mockResolvedValueOnce(largeQueryResult);

      const handler = registeredTools.get('execute_card')?.[2];
      const result = await handler({ card_id: 1 });

      const data = JSON.parse(result.content[0].text);
      expect(data.rows.length).toBeLessThanOrEqual(context.config.metabase.maxRows);
      expect(data.truncated).toBe(true);
    });
  });

  describe('list_databases', () => {
    it('returns list of databases', async () => {
      const handler = registeredTools.get('list_databases')?.[2];
      const result = await handler({});

      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0].text);
      expect(data.count).toBe(3);
      expect(data.databases[0].name).toBe('Production Database');
      expect(data.databases[0].engine).toBe('postgres');
    });
  });

  describe('get_database_schema', () => {
    it('returns database schema', async () => {
      const handler = registeredTools.get('get_database_schema')?.[2];
      const result = await handler({ database_id: 1 });

      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0].text);
      expect(data.tables).toHaveLength(3);
      expect(data.tables[0].name).toBe('users');
    });

    it('caches schema after first call', async () => {
      const handler = registeredTools.get('get_database_schema')?.[2];

      await handler({ database_id: 1 });
      await handler({ database_id: 1 });

      // SchemaManager should cache, so only one call to Metabase
      expect(mockClient.getDatabaseSchema).toHaveBeenCalledTimes(1);
    });
  });

  describe('execute_query', () => {
    it('executes valid SQL query', async () => {
      const handler = registeredTools.get('execute_query')?.[2];
      const result = await handler({
        database_id: 1,
        sql: 'SELECT * FROM users LIMIT 10',
      });

      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0].text);
      expect(data.columns).toBeDefined();
      expect(data.rows).toBeDefined();
    });

    it('blocks dangerous SQL', async () => {
      const handler = registeredTools.get('execute_query')?.[2];
      const result = await handler({
        database_id: 1,
        sql: 'DROP TABLE users',
      });

      expect(result.isError).toBe(true);
      const data = JSON.parse(result.content[0].text);
      expect(data.error).toContain('SQL validation failed');
    });

    it('blocks SQL injection attempts', async () => {
      const handler = registeredTools.get('execute_query')?.[2];
      const result = await handler({
        database_id: 1,
        sql: "SELECT * FROM users; DROP TABLE users;--",
      });

      expect(result.isError).toBe(true);
    });

    it('includes warnings in response', async () => {
      const handler = registeredTools.get('execute_query')?.[2];
      const result = await handler({
        database_id: 1,
        sql: 'SELECT * FROM users', // No LIMIT, should warn
      });

      // Even valid queries can have warnings
      const data = JSON.parse(result.content[0].text);
      expect(data.warnings).toBeDefined();
    });

    it('sanitizes SQL before execution', async () => {
      const handler = registeredTools.get('execute_query')?.[2];
      await handler({
        database_id: 1,
        sql: '  SELECT    *   FROM   users   LIMIT 10  ',
      });

      // Check that normalized SQL was passed to client
      expect(mockClient.executeQuery).toHaveBeenCalledWith(
        1,
        expect.stringContaining('SELECT')
      );
    });
  });

  describe('search_content', () => {
    it('searches Metabase content', async () => {
      mockClient.search.mockResolvedValueOnce([
        { id: 1, name: 'Sales', description: null, model: 'dashboard', collection_id: 1, collection_name: 'Analytics' },
      ]);

      const handler = registeredTools.get('search_content')?.[2];
      const result = await handler({ query: 'sales' });

      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0].text);
      expect(data.count).toBe(1);
      expect(mockClient.search).toHaveBeenCalledWith('sales', undefined);
    });

    it('filters by content type', async () => {
      const handler = registeredTools.get('search_content')?.[2];
      await handler({ query: 'sales', type: 'dashboard' });

      expect(mockClient.search).toHaveBeenCalledWith('sales', ['dashboard']);
    });
  });

  describe('get_collections', () => {
    it('returns list of collections', async () => {
      const handler = registeredTools.get('get_collections')?.[2];
      const result = await handler({});

      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0].text);
      expect(data.count).toBe(3);
      expect(data.collections[0].name).toBe('Analytics');
    });
  });

  describe('error handling', () => {
    it('handles Metabase client errors gracefully', async () => {
      mockClient.getDashboards.mockRejectedValueOnce(new Error('Connection failed'));

      const handler = registeredTools.get('list_dashboards')?.[2];
      const result = await handler({});

      expect(result.isError).toBe(true);
      const data = JSON.parse(result.content[0].text);
      expect(data.error).toContain('Connection failed');
    });
  });

  describe('audit logging', () => {
    it('logs successful operations', async () => {
      const logSpy = vi.spyOn(context.auditLogger, 'logSuccess');

      const handler = registeredTools.get('list_dashboards')?.[2];
      await handler({});

      expect(logSpy).toHaveBeenCalledWith('list_dashboards', expect.any(Object));
    });

    it('logs failed operations', async () => {
      const logSpy = vi.spyOn(context.auditLogger, 'logFailure');
      mockClient.getDashboards.mockRejectedValueOnce(new Error('Failed'));

      const handler = registeredTools.get('list_dashboards')?.[2];
      await handler({});

      expect(logSpy).toHaveBeenCalled();
    });

    it('logs blocked SQL queries', async () => {
      const logSpy = vi.spyOn(context.auditLogger, 'logBlocked');

      const handler = registeredTools.get('execute_query')?.[2];
      await handler({ database_id: 1, sql: 'DROP TABLE users' });

      expect(logSpy).toHaveBeenCalledWith('execute_query', expect.any(String), expect.any(Object));
    });
  });
});
