/**
 * Workflow Tools Integration Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerWorkflowTools } from '../../src/tools/workflow-tools.js';
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

describe('Workflow Tools Integration', () => {
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

    registerWorkflowTools(server, context);
  });

  describe('run_workflow', () => {
    it('registers the tool', () => {
      expect(registeredTools.has('run_workflow')).toBe(true);
    });

    it('executes a single step workflow', async () => {
      const handler = registeredTools.get('run_workflow')?.handler;
      const result = await handler({
        steps: [
          { name: 'dashboards', tool: 'list_dashboards' },
        ],
      });

      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0].text);
      expect(data.completed).toBe(true);
      expect(data.total_steps).toBe(1);
      expect(data.succeeded).toBe(1);
      expect(data.steps[0].name).toBe('dashboards');
      expect(data.steps[0].success).toBe(true);
    });

    it('chains steps with output references', async () => {
      mockClient.getDashboard.mockResolvedValue(sampleDashboards[0]);

      const handler = registeredTools.get('run_workflow')?.handler;
      const result = await handler({
        steps: [
          { name: 'find', tool: 'list_dashboards' },
          {
            name: 'details',
            tool: 'get_dashboard',
            args: { dashboard_id: '$find.dashboards[0].id' },
          },
        ],
      });

      const data = JSON.parse(result.content[0].text);
      expect(data.completed).toBe(true);
      expect(data.succeeded).toBe(2);
      expect(mockClient.getDashboard).toHaveBeenCalledWith(1);
    });

    it('handles nested path references', async () => {
      mockClient.search.mockResolvedValue([
        { id: 42, name: 'Revenue Card', model: 'card', collection_id: 1, collection_name: 'Analytics', description: null },
      ]);

      const handler = registeredTools.get('run_workflow')?.handler;
      const result = await handler({
        steps: [
          { name: 'search', tool: 'search_content', args: { query: 'revenue' } },
          {
            name: 'card',
            tool: 'get_card',
            args: { card_id: '$search.results[0].id' },
          },
        ],
      });

      const data = JSON.parse(result.content[0].text);
      expect(data.completed).toBe(true);
      expect(mockClient.getCard).toHaveBeenCalledWith(42);
    });

    it('aborts on error by default', async () => {
      mockClient.getDashboard.mockRejectedValueOnce(new Error('Not found'));

      const handler = registeredTools.get('run_workflow')?.handler;
      const result = await handler({
        steps: [
          { name: 'fail', tool: 'get_dashboard', args: { dashboard_id: 999 } },
          { name: 'never_runs', tool: 'list_databases' },
        ],
      });

      const data = JSON.parse(result.content[0].text);
      expect(data.completed).toBe(false);
      expect(data.aborted_at).toBe('fail');
      expect(data.steps).toHaveLength(1);
      expect(mockClient.getDatabases).not.toHaveBeenCalled();
    });

    it('continues on error when on_error is "continue"', async () => {
      mockClient.getDashboard.mockRejectedValueOnce(new Error('Not found'));

      const handler = registeredTools.get('run_workflow')?.handler;
      const result = await handler({
        steps: [
          { name: 'fail', tool: 'get_dashboard', args: { dashboard_id: 999 }, on_error: 'continue' },
          { name: 'succeeds', tool: 'list_databases' },
        ],
      });

      const data = JSON.parse(result.content[0].text);
      expect(data.completed).toBe(true);
      expect(data.succeeded).toBe(1);
      expect(data.failed).toBe(1);
      expect(data.steps).toHaveLength(2);
      expect(data.steps[0].success).toBe(false);
      expect(data.steps[1].success).toBe(true);
    });

    it('rejects duplicate step names', async () => {
      const handler = registeredTools.get('run_workflow')?.handler;
      const result = await handler({
        steps: [
          { name: 'step1', tool: 'list_dashboards' },
          { name: 'step1', tool: 'list_databases' },
        ],
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Duplicate step name');
    });

    it('validates SQL in execute_query steps', async () => {
      const handler = registeredTools.get('run_workflow')?.handler;
      const result = await handler({
        steps: [
          {
            name: 'query',
            tool: 'execute_query',
            args: { database_id: 1, sql: 'DROP TABLE users' },
          },
        ],
      });

      const data = JSON.parse(result.content[0].text);
      expect(data.completed).toBe(false);
      expect(data.steps[0].success).toBe(false);
      expect(data.steps[0].error).toContain('SQL validation failed');
    });

    it('executes a multi-step data exploration workflow', async () => {
      mockClient.search.mockResolvedValue([
        { id: 1, name: 'Revenue', model: 'card', collection_id: 1, collection_name: 'Analytics', description: null },
      ]);

      const handler = registeredTools.get('run_workflow')?.handler;
      const result = await handler({
        steps: [
          { name: 'search', tool: 'search_content', args: { query: 'revenue', type: 'card' } },
          { name: 'card', tool: 'get_card', args: { card_id: '$search.results[0].id' } },
          { name: 'data', tool: 'execute_card', args: { card_id: '$search.results[0].id' } },
        ],
      });

      const data = JSON.parse(result.content[0].text);
      expect(data.completed).toBe(true);
      expect(data.succeeded).toBe(3);
      expect(data.total_steps).toBe(3);
    });

    it('returns compact JSON responses', async () => {
      const handler = registeredTools.get('run_workflow')?.handler;
      const result = await handler({
        steps: [{ name: 'test', tool: 'list_dashboards' }],
      });

      // Compact = no indentation/newlines in JSON
      expect(result.content[0].text).not.toContain('\n');
    });

    it('includes per-step timing', async () => {
      const handler = registeredTools.get('run_workflow')?.handler;
      const result = await handler({
        steps: [
          { name: 'step1', tool: 'list_dashboards' },
          { name: 'step2', tool: 'list_databases' },
        ],
      });

      const data = JSON.parse(result.content[0].text);
      expect(data.duration_ms).toBeDefined();
      for (const step of data.steps) {
        expect(step.duration_ms).toBeDefined();
        expect(typeof step.duration_ms).toBe('number');
      }
    });

    it('resolves array references in args', async () => {
      const handler = registeredTools.get('run_workflow')?.handler;
      const result = await handler({
        steps: [
          { name: 'dbs', tool: 'list_databases' },
          {
            name: 'cards',
            tool: 'list_cards',
            args: {},
          },
        ],
      });

      const data = JSON.parse(result.content[0].text);
      expect(data.completed).toBe(true);
      expect(data.succeeded).toBe(2);
    });
  });
});
