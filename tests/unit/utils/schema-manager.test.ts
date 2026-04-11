/**
 * Schema Manager Unit Tests
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { SchemaManager } from '../../../src/utils/schema-manager.js';
import { createMockMetabaseClient, mockResponses } from '../../setup.js';

describe('SchemaManager', () => {
  let schemaManager: SchemaManager;
  let mockClient: ReturnType<typeof createMockMetabaseClient>;

  beforeEach(() => {
    mockClient = createMockMetabaseClient();
    schemaManager = new SchemaManager(mockClient as any, {
      ttlMs: 60000, // 1 minute TTL for testing
    });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('getSchema', () => {
    it('fetches schema from Metabase client', async () => {
      const schema = await schemaManager.getSchema(1);

      expect(mockClient.getDatabaseSchema).toHaveBeenCalledWith(1);
      expect(schema.tables).toHaveLength(2);
      expect(schema.tables[0].name).toBe('users');
      expect(schema.tables[1].name).toBe('orders');
    });

    it('returns cached schema on subsequent calls', async () => {
      await schemaManager.getSchema(1);
      await schemaManager.getSchema(1);
      await schemaManager.getSchema(1);

      expect(mockClient.getDatabaseSchema).toHaveBeenCalledTimes(1);
    });

    it('fetches fresh schema after TTL expires', async () => {
      await schemaManager.getSchema(1);
      expect(mockClient.getDatabaseSchema).toHaveBeenCalledTimes(1);

      // Advance time past TTL
      vi.advanceTimersByTime(61000);

      await schemaManager.getSchema(1);
      expect(mockClient.getDatabaseSchema).toHaveBeenCalledTimes(2);
    });

    it('caches different databases separately', async () => {
      await schemaManager.getSchema(1);
      await schemaManager.getSchema(2);

      expect(mockClient.getDatabaseSchema).toHaveBeenCalledTimes(2);
      expect(mockClient.getDatabaseSchema).toHaveBeenCalledWith(1);
      expect(mockClient.getDatabaseSchema).toHaveBeenCalledWith(2);
    });

    it('processes schema correctly', async () => {
      const schema = await schemaManager.getSchema(1);

      // Check table structure
      expect(schema.tables[0]).toHaveProperty('name');
      expect(schema.tables[0]).toHaveProperty('description');
      expect(schema.tables[0]).toHaveProperty('columns');

      // Check column structure
      const userTable = schema.tables.find(t => t.name === 'users');
      expect(userTable?.columns).toHaveLength(3);
      expect(userTable?.columns[0]).toHaveProperty('name');
      expect(userTable?.columns[0]).toHaveProperty('type');
    });

    it('simplifies type names', async () => {
      const schema = await schemaManager.getSchema(1);
      const userTable = schema.tables.find(t => t.name === 'users');

      // type/Integer should become INTEGER
      const idColumn = userTable?.columns.find(c => c.name === 'id');
      expect(idColumn?.type).toBe('INTEGER');

      // type/Text should become TEXT
      const emailColumn = userTable?.columns.find(c => c.name === 'email');
      expect(emailColumn?.type).toBe('TEXT');

      // type/DateTime should become DATETIME
      const createdAtColumn = userTable?.columns.find(c => c.name === 'created_at');
      expect(createdAtColumn?.type).toBe('DATETIME');
    });
  });

  describe('getFilteredSchema', () => {
    it('returns only specified tables', async () => {
      const schema = await schemaManager.getFilteredSchema(1, ['users']);

      expect(schema.tables).toHaveLength(1);
      expect(schema.tables[0].name).toBe('users');
    });

    it('is case-insensitive for table names', async () => {
      const schema = await schemaManager.getFilteredSchema(1, ['USERS', 'Orders']);

      expect(schema.tables).toHaveLength(2);
    });

    it('returns empty array for non-existent tables', async () => {
      const schema = await schemaManager.getFilteredSchema(1, ['nonexistent']);

      expect(schema.tables).toHaveLength(0);
    });

    it('uses cached schema', async () => {
      await schemaManager.getSchema(1);
      await schemaManager.getFilteredSchema(1, ['users']);
      await schemaManager.getFilteredSchema(1, ['orders']);

      expect(mockClient.getDatabaseSchema).toHaveBeenCalledTimes(1);
    });
  });

  describe('refreshSchema', () => {
    it('forces fresh fetch even if cached', async () => {
      await schemaManager.getSchema(1);
      await schemaManager.refreshSchema(1);

      expect(mockClient.getDatabaseSchema).toHaveBeenCalledTimes(2);
    });

    it('updates cache with fresh data', async () => {
      await schemaManager.getSchema(1);

      // Update mock response
      const updatedMetadata = {
        ...mockResponses.databaseMetadata,
        tables: [...mockResponses.databaseMetadata.tables, {
          id: 3,
          name: 'new_table',
          display_name: 'New Table',
          description: null,
          schema: 'public',
          fields: [],
        }],
      };
      mockClient.getDatabaseSchema.mockResolvedValueOnce(updatedMetadata);

      const refreshed = await schemaManager.refreshSchema(1);

      expect(refreshed.tables).toHaveLength(3);
    });
  });

  describe('clearCache', () => {
    it('clears all cached schemas', async () => {
      await schemaManager.getSchema(1);
      await schemaManager.getSchema(2);

      schemaManager.clearCache();

      expect(schemaManager.isCached(1)).toBe(false);
      expect(schemaManager.isCached(2)).toBe(false);
    });

    it('requires fresh fetch after clearing', async () => {
      await schemaManager.getSchema(1);
      schemaManager.clearCache();
      await schemaManager.getSchema(1);

      expect(mockClient.getDatabaseSchema).toHaveBeenCalledTimes(2);
    });
  });

  describe('isCached', () => {
    it('returns false for uncached database', () => {
      expect(schemaManager.isCached(999)).toBe(false);
    });

    it('returns true for cached database', async () => {
      await schemaManager.getSchema(1);
      expect(schemaManager.isCached(1)).toBe(true);
    });

    it('returns false after TTL expires', async () => {
      await schemaManager.getSchema(1);
      expect(schemaManager.isCached(1)).toBe(true);

      vi.advanceTimersByTime(61000);

      expect(schemaManager.isCached(1)).toBe(false);
    });
  });

  describe('getCacheStats', () => {
    it('returns empty stats when nothing cached', () => {
      const stats = schemaManager.getCacheStats();

      expect(stats.cachedDatabases).toBe(0);
      expect(stats.entries).toHaveLength(0);
    });

    it('returns correct stats for cached databases', async () => {
      await schemaManager.getSchema(1);
      await schemaManager.getSchema(2);

      const stats = schemaManager.getCacheStats();

      expect(stats.cachedDatabases).toBe(2);
      expect(stats.entries).toHaveLength(2);
      expect(stats.entries[0]).toHaveProperty('databaseId');
      expect(stats.entries[0]).toHaveProperty('expiresIn');
      expect(stats.entries[0]).toHaveProperty('tableCount');
    });

    it('reports correct expiration times', async () => {
      await schemaManager.getSchema(1);

      const stats1 = schemaManager.getCacheStats();
      expect(stats1.entries[0].expiresIn).toBeCloseTo(60000, -3);

      vi.advanceTimersByTime(30000);

      const stats2 = schemaManager.getCacheStats();
      expect(stats2.entries[0].expiresIn).toBeCloseTo(30000, -3);
    });
  });

  describe('formatSchemaForPrompt', () => {
    it('formats schema as readable text', async () => {
      const schema = await schemaManager.getSchema(1);
      const formatted = schemaManager.formatSchemaForPrompt(schema);

      expect(formatted).toContain('DATABASE SCHEMA:');
      expect(formatted).toContain('Table: users');
      expect(formatted).toContain('Table: orders');
      expect(formatted).toContain('Columns:');
      expect(formatted).toContain('- id (INTEGER)');
      expect(formatted).toContain('- email (TEXT)');
    });

    it('includes table descriptions when available', async () => {
      const schema = await schemaManager.getSchema(1);
      const formatted = schemaManager.formatSchemaForPrompt(schema);

      expect(formatted).toContain('User accounts');
      expect(formatted).toContain('Customer orders');
    });

    it('includes column descriptions when available', async () => {
      const schema = await schemaManager.getSchema(1);
      const formatted = schemaManager.formatSchemaForPrompt(schema);

      expect(formatted).toContain('Primary key');
      expect(formatted).toContain('User email');
    });
  });

  describe('large schema handling', () => {
    it('limits tables when schema is too large', async () => {
      // Create mock with many tables
      const manyTables = Array.from({ length: 150 }, (_, i) => ({
        id: i + 1,
        name: `table_${i}`,
        display_name: `Table ${i}`,
        description: null,
        schema: 'public',
        fields: [
          { id: i * 10, name: 'id', display_name: 'ID', description: null, base_type: 'type/Integer', semantic_type: null, fk_target_field_id: null },
        ],
      }));

      mockClient.getDatabaseSchema.mockResolvedValueOnce({
        id: 1,
        name: 'Large DB',
        tables: manyTables,
      });

      const manager = new SchemaManager(mockClient as any, {
        maxTables: 100,
        maxColumnsPerTable: 50,
      });

      const schema = await manager.getSchema(1);

      expect(schema.tables.length).toBeLessThanOrEqual(100);
    });

    it('limits columns per table', async () => {
      // Create mock with many columns
      const manyColumns = Array.from({ length: 100 }, (_, i) => ({
        id: i + 1,
        name: `column_${i}`,
        display_name: `Column ${i}`,
        description: null,
        base_type: 'type/Text',
        semantic_type: null,
        fk_target_field_id: null,
      }));

      mockClient.getDatabaseSchema.mockResolvedValueOnce({
        id: 1,
        name: 'Wide Table DB',
        tables: [{
          id: 1,
          name: 'wide_table',
          display_name: 'Wide Table',
          description: null,
          schema: 'public',
          fields: manyColumns,
        }],
      });

      const manager = new SchemaManager(mockClient as any, {
        maxColumnsPerTable: 50,
      });

      const schema = await manager.getSchema(1);

      expect(schema.tables[0].columns.length).toBeLessThanOrEqual(50);
    });
  });
});
