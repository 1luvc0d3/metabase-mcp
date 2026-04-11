/**
 * Write Tools Integration Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerWriteTools } from '../../src/tools/write-tools.js';
import type { ToolContext } from '../../src/tools/types.js';
import { SQLGuardrails } from '../../src/security/sql-guardrails.js';
import { TieredRateLimiter } from '../../src/security/rate-limiter.js';
import { AuditLogger } from '../../src/security/audit-logger.js';
import { SchemaManager } from '../../src/utils/schema-manager.js';
import { Logger } from '../../src/config.js';
import { createMockMetabaseClient, createTestConfig } from '../setup.js';
import { sampleCards, sampleDashboards, sampleCollections } from '../fixtures/index.js';

describe('Write Tools Integration', () => {
  let server: McpServer;
  let mockClient: ReturnType<typeof createMockMetabaseClient>;
  let context: ToolContext;
  let registeredTools: Map<string, any>;

  beforeEach(() => {
    server = new McpServer({ name: 'test', version: '1.0.0' });
    mockClient = createMockMetabaseClient();

    // Set up mock responses
    mockClient.createCard.mockResolvedValue({ ...sampleCards[0], id: 100 });
    mockClient.updateCard.mockResolvedValue(sampleCards[0]);
    mockClient.deleteCard.mockResolvedValue(undefined);
    mockClient.getCard.mockResolvedValue(sampleCards[0]);
    mockClient.createDashboard.mockResolvedValue({ ...sampleDashboards[0], id: 100 });
    mockClient.updateDashboard.mockResolvedValue(sampleDashboards[0]);
    mockClient.deleteDashboard.mockResolvedValue(undefined);
    mockClient.createCollection.mockResolvedValue({ ...sampleCollections[0], id: 100 });
    mockClient.addCardToDashboard.mockResolvedValue(undefined);
    mockClient.removeCardFromDashboard.mockResolvedValue(undefined);

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

    registerWriteTools(server, context);
  });

  describe('create_card', () => {
    it('registers the tool', () => {
      expect(registeredTools.has('create_card')).toBe(true);
    });

    it('creates a new card with valid SQL', async () => {
      const handler = registeredTools.get('create_card')?.[2];
      const result = await handler({
        name: 'New Card',
        database_id: 1,
        sql: 'SELECT * FROM users LIMIT 100',
        display: 'table',
      });

      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);
      expect(data.card.id).toBe(100);
    });

    it('validates SQL before creating card', async () => {
      const handler = registeredTools.get('create_card')?.[2];
      const result = await handler({
        name: 'Bad Card',
        database_id: 1,
        sql: 'DROP TABLE users',
        display: 'table',
      });

      expect(result.isError).toBe(true);
      expect(mockClient.createCard).not.toHaveBeenCalled();
    });

    it('passes all parameters to Metabase client', async () => {
      const handler = registeredTools.get('create_card')?.[2];
      await handler({
        name: 'Test Card',
        database_id: 1,
        sql: 'SELECT id FROM users',
        collection_id: 5,
        description: 'Test description',
        display: 'line',
      });

      expect(mockClient.createCard).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Test Card',
          description: 'Test description',
          display: 'line',
          collection_id: 5,
        })
      );
    });
  });

  describe('update_card', () => {
    it('updates card name', async () => {
      const handler = registeredTools.get('update_card')?.[2];
      const result = await handler({
        card_id: 1,
        name: 'Updated Name',
      });

      expect(result.isError).toBeFalsy();
      expect(mockClient.updateCard).toHaveBeenCalledWith(1, { name: 'Updated Name' });
    });

    it('updates card SQL with validation', async () => {
      const handler = registeredTools.get('update_card')?.[2];
      await handler({
        card_id: 1,
        sql: 'SELECT * FROM orders',
      });

      expect(mockClient.updateCard).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          dataset_query: expect.objectContaining({
            native: expect.objectContaining({
              query: expect.stringContaining('SELECT'),
            }),
          }),
        })
      );
    });

    it('rejects invalid SQL updates', async () => {
      const handler = registeredTools.get('update_card')?.[2];
      const result = await handler({
        card_id: 1,
        sql: 'DELETE FROM users',
      });

      expect(result.isError).toBe(true);
      expect(mockClient.updateCard).not.toHaveBeenCalled();
    });

    it('updates multiple fields at once', async () => {
      const handler = registeredTools.get('update_card')?.[2];
      await handler({
        card_id: 1,
        name: 'New Name',
        description: 'New Description',
        collection_id: 10,
      });

      expect(mockClient.updateCard).toHaveBeenCalledWith(1, {
        name: 'New Name',
        description: 'New Description',
        collection_id: 10,
      });
    });
  });

  describe('delete_card', () => {
    it('deletes/archives a card', async () => {
      const handler = registeredTools.get('delete_card')?.[2];
      const result = await handler({ card_id: 1 });

      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);
      expect(mockClient.deleteCard).toHaveBeenCalledWith(1);
    });
  });

  describe('create_dashboard', () => {
    it('creates a new dashboard', async () => {
      const handler = registeredTools.get('create_dashboard')?.[2];
      const result = await handler({
        name: 'New Dashboard',
        description: 'Dashboard description',
      });

      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);
      expect(data.dashboard.id).toBe(100);
    });

    it('passes collection_id when provided', async () => {
      const handler = registeredTools.get('create_dashboard')?.[2];
      await handler({
        name: 'New Dashboard',
        collection_id: 5,
      });

      expect(mockClient.createDashboard).toHaveBeenCalledWith({
        name: 'New Dashboard',
        description: undefined,
        collection_id: 5,
      });
    });
  });

  describe('update_dashboard', () => {
    it('updates dashboard properties', async () => {
      const handler = registeredTools.get('update_dashboard')?.[2];
      const result = await handler({
        dashboard_id: 1,
        name: 'Updated Dashboard',
        description: 'Updated description',
      });

      expect(result.isError).toBeFalsy();
      expect(mockClient.updateDashboard).toHaveBeenCalledWith(1, {
        name: 'Updated Dashboard',
        description: 'Updated description',
      });
    });
  });

  describe('delete_dashboard', () => {
    it('deletes/archives a dashboard', async () => {
      const handler = registeredTools.get('delete_dashboard')?.[2];
      const result = await handler({ dashboard_id: 1 });

      expect(result.isError).toBeFalsy();
      expect(mockClient.deleteDashboard).toHaveBeenCalledWith(1);
    });
  });

  describe('add_card_to_dashboard', () => {
    it('adds card to dashboard with default position', async () => {
      const handler = registeredTools.get('add_card_to_dashboard')?.[2];
      const result = await handler({
        dashboard_id: 1,
        card_id: 5,
      });

      expect(result.isError).toBeFalsy();
      expect(mockClient.addCardToDashboard).toHaveBeenCalledWith(1, 5, {
        row: 0,
        col: 0,
        size_x: 4,
        size_y: 4,
      });
    });

    it('adds card with custom position and size', async () => {
      const handler = registeredTools.get('add_card_to_dashboard')?.[2];
      await handler({
        dashboard_id: 1,
        card_id: 5,
        row: 2,
        col: 6,
        size_x: 8,
        size_y: 6,
      });

      expect(mockClient.addCardToDashboard).toHaveBeenCalledWith(1, 5, {
        row: 2,
        col: 6,
        size_x: 8,
        size_y: 6,
      });
    });
  });

  describe('remove_card_from_dashboard', () => {
    it('removes card from dashboard', async () => {
      const handler = registeredTools.get('remove_card_from_dashboard')?.[2];
      const result = await handler({
        dashboard_id: 1,
        dashcard_id: 10,
      });

      expect(result.isError).toBeFalsy();
      expect(mockClient.removeCardFromDashboard).toHaveBeenCalledWith(1, 10);
    });
  });

  describe('create_collection', () => {
    it('creates a new collection', async () => {
      const handler = registeredTools.get('create_collection')?.[2];
      const result = await handler({
        name: 'New Collection',
        description: 'Collection description',
        color: '#FF0000',
      });

      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);
      expect(mockClient.createCollection).toHaveBeenCalledWith({
        name: 'New Collection',
        description: 'Collection description',
        color: '#FF0000',
        parent_id: undefined,
      });
    });

    it('creates nested collection with parent_id', async () => {
      const handler = registeredTools.get('create_collection')?.[2];
      await handler({
        name: 'Sub Collection',
        parent_id: 1,
      });

      expect(mockClient.createCollection).toHaveBeenCalledWith(
        expect.objectContaining({
          parent_id: 1,
        })
      );
    });
  });

  describe('move_to_collection', () => {
    it('moves card to collection', async () => {
      const handler = registeredTools.get('move_to_collection')?.[2];
      const result = await handler({
        item_type: 'card',
        item_id: 1,
        collection_id: 5,
      });

      expect(result.isError).toBeFalsy();
      expect(mockClient.updateCard).toHaveBeenCalledWith(1, { collection_id: 5 });
    });

    it('moves dashboard to collection', async () => {
      const handler = registeredTools.get('move_to_collection')?.[2];
      await handler({
        item_type: 'dashboard',
        item_id: 1,
        collection_id: 5,
      });

      expect(mockClient.updateDashboard).toHaveBeenCalledWith(1, { collection_id: 5 });
    });
  });

  describe('rate limiting', () => {
    it('enforces write rate limits', async () => {
      const handler = registeredTools.get('create_card')?.[2];

      // Exhaust the write rate limit (30 per minute by default)
      for (let i = 0; i < 30; i++) {
        context.rateLimiter.checkLimit('write');
      }

      const result = await handler({
        name: 'Test',
        database_id: 1,
        sql: 'SELECT 1',
        display: 'table',
      });

      expect(result.isError).toBe(true);
    });
  });

  describe('error handling', () => {
    it('handles Metabase API errors', async () => {
      mockClient.createCard.mockRejectedValueOnce(new Error('API Error'));

      const handler = registeredTools.get('create_card')?.[2];
      const result = await handler({
        name: 'Test',
        database_id: 1,
        sql: 'SELECT 1',
        display: 'table',
      });

      expect(result.isError).toBe(true);
      const data = JSON.parse(result.content[0].text);
      expect(data.error).toContain('API Error');
    });
  });

  describe('audit logging', () => {
    it('logs successful write operations', async () => {
      const logSpy = vi.spyOn(context.auditLogger, 'logSuccess');

      const handler = registeredTools.get('create_dashboard')?.[2];
      await handler({ name: 'Test Dashboard' });

      expect(logSpy).toHaveBeenCalledWith('create_dashboard', expect.any(Object));
    });

    it('logs failed write operations', async () => {
      const logSpy = vi.spyOn(context.auditLogger, 'logFailure');
      mockClient.createDashboard.mockRejectedValueOnce(new Error('Failed'));

      const handler = registeredTools.get('create_dashboard')?.[2];
      await handler({ name: 'Test Dashboard' });

      expect(logSpy).toHaveBeenCalled();
    });

    it('logs blocked SQL in write operations', async () => {
      const logSpy = vi.spyOn(context.auditLogger, 'logBlocked');

      const handler = registeredTools.get('create_card')?.[2];
      await handler({
        name: 'Bad Card',
        database_id: 1,
        sql: 'INSERT INTO users VALUES (1)',
        display: 'table',
      });

      expect(logSpy).toHaveBeenCalled();
    });
  });
});
