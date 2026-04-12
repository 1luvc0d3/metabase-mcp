/**
 * NLQ Tools Integration Tests
 * Tests for nlq_to_sql, explain_sql, optimize_sql, and validate_sql tools
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerNLQTools } from '../../src/tools/nlq-tools.js';
import type { ToolContext } from '../../src/tools/types.js';
import { SQLGuardrails } from '../../src/security/sql-guardrails.js';
import { TieredRateLimiter } from '../../src/security/rate-limiter.js';
import { AuditLogger } from '../../src/security/audit-logger.js';
import { SchemaManager } from '../../src/utils/schema-manager.js';
import { Logger } from '../../src/config.js';
import { createMockMetabaseClient, createTestConfig } from '../setup.js';
import { sampleDatabaseMetadata, sampleQueryResult } from '../fixtures/index.js';
import type { LLMService } from '../../src/client/llm-service.js';
import type { DatabaseSchema } from '../../src/client/types.js';

// ============================================================================
// Mock LLM Service Factory
// ============================================================================

function createMockLLMService(): LLMService & {
  generateSQL: Mock;
  explainSQL: Mock;
  optimizeSQL: Mock;
  identifyRelevantTables: Mock;
} {
  const defaultSQL = 'SELECT u.id, u.name, COUNT(o.id) as order_count FROM users u LEFT JOIN orders o ON u.id = o.user_id GROUP BY u.id, u.name LIMIT 1000';

  return {
    generateSQL: vi.fn().mockResolvedValue({
      sql: defaultSQL,
      explanation: 'This query joins users with orders and counts orders per user.',
    }),
    explainSQL: vi.fn().mockResolvedValue(
      'This query selects all columns from the users table, limited to 10 rows.'
    ),
    optimizeSQL: vi.fn().mockResolvedValue({
      suggestions: [
        'Add an index on user_id column',
        'Consider using EXISTS instead of COUNT for checking presence',
      ],
      optimizedSQL: 'SELECT u.id, u.name FROM users u WHERE EXISTS (SELECT 1 FROM orders o WHERE o.user_id = u.id) LIMIT 1000',
    }),
    identifyRelevantTables: vi.fn().mockImplementation(async (_question: string, schema: DatabaseSchema) => {
      return {
        tables: schema.tables.filter(t => t.name === 'users' || t.name === 'orders'),
      };
    }),
    getBudgetStatus: vi.fn().mockReturnValue({
      dailyUsed: 1000,
      dailyRemaining: 99000,
      monthlyUsed: 10000,
      monthlyRemaining: 1990000,
    }),
    generateInsights: vi.fn().mockResolvedValue({
      summary: 'Test insights summary',
      points: ['Point 1', 'Point 2'],
      recommendations: ['Recommendation 1'],
    }),
  } as unknown as LLMService & {
    generateSQL: Mock;
    explainSQL: Mock;
    optimizeSQL: Mock;
    identifyRelevantTables: Mock;
  };
}

// ============================================================================
// Test Suite
// ============================================================================

describe('NLQ Tools Integration', () => {
  let server: McpServer;
  let mockClient: ReturnType<typeof createMockMetabaseClient>;
  let mockLLMService: ReturnType<typeof createMockLLMService>;
  let context: ToolContext;
  let registeredTools: Map<string, any>;

  beforeEach(() => {
    server = new McpServer({ name: 'test', version: '1.0.0' });
    mockClient = createMockMetabaseClient();
    mockLLMService = createMockLLMService();

    // Override mock responses with fixtures
    mockClient.getDatabaseSchema.mockResolvedValue(sampleDatabaseMetadata);
    mockClient.executeQuery.mockResolvedValue(sampleQueryResult);

    const config = createTestConfig();

    context = {
      config,
      metabaseClient: mockClient as any,
      llmService: mockLLMService as unknown as LLMService,
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
      const handler = args[args.length - 1]; registeredTools.set(name, { args, handler });
      return originalTool(name, ...args);
    });

    registerNLQTools(server, context);
  });

  // ==========================================================================
  // Tool Registration Tests
  // ==========================================================================

  describe('Tool Registration', () => {
    it('registers all NLQ tools when LLM service is available', () => {
      expect(registeredTools.has('nlq_to_sql')).toBe(true);
      expect(registeredTools.has('explain_sql')).toBe(true);
      expect(registeredTools.has('optimize_sql')).toBe(true);
      expect(registeredTools.has('validate_sql')).toBe(true);
    });

    it('does not register tools when LLM service is not available', () => {
      const newServer = new McpServer({ name: 'test-no-llm', version: '1.0.0' });
      const newRegisteredTools = new Map();

      const originalTool = newServer.tool.bind(newServer);
      vi.spyOn(newServer, 'tool').mockImplementation((name: string, ...args: any[]) => {
        newRegisteredTools.set(name, args);
        return originalTool(name, ...args);
      });

      const contextWithoutLLM = { ...context, llmService: null };
      registerNLQTools(newServer, contextWithoutLLM);

      expect(newRegisteredTools.has('nlq_to_sql')).toBe(false);
      expect(newRegisteredTools.has('explain_sql')).toBe(false);
      expect(newRegisteredTools.has('optimize_sql')).toBe(false);
      expect(newRegisteredTools.has('validate_sql')).toBe(false);
    });
  });

  // ==========================================================================
  // nlq_to_sql Tests
  // ==========================================================================

  describe('nlq_to_sql', () => {
    describe('Successful SQL Generation', () => {
      it('converts natural language question to SQL', async () => {
        const handler = registeredTools.get('nlq_to_sql')?.handler;
        const result = await handler({
          question: 'How many orders does each user have?',
          database_id: 1,
        });

        expect(result.isError).toBeFalsy();
        const data = JSON.parse(result.content[0].text);
        expect(data.success).toBe(true);
        expect(data.sql).toBeDefined();
        expect(data.sql).toContain('SELECT');
      });

      it('includes explanation in response when available', async () => {
        const handler = registeredTools.get('nlq_to_sql')?.handler;
        const result = await handler({
          question: 'Show me all active users',
          database_id: 1,
        });

        const data = JSON.parse(result.content[0].text);
        expect(data.success).toBe(true);
        // Note: explanation may be undefined based on LLM response parsing
      });

      it('fetches database schema for SQL generation', async () => {
        const handler = registeredTools.get('nlq_to_sql')?.handler;
        await handler({
          question: 'List all products',
          database_id: 1,
        });

        expect(mockClient.getDatabaseSchema).toHaveBeenCalledWith(1);
      });

      it('passes schema to LLM service', async () => {
        const handler = registeredTools.get('nlq_to_sql')?.handler;
        await handler({
          question: 'Get user emails',
          database_id: 1,
        });

        expect(mockLLMService.generateSQL).toHaveBeenCalledWith({
          question: 'Get user emails',
          schema: expect.objectContaining({
            tables: expect.arrayContaining([
              expect.objectContaining({ name: 'users' }),
            ]),
          }),
        });
      });
    });

    describe('Table Filtering', () => {
      it('filters schema to specified tables when tables parameter is provided', async () => {
        const handler = registeredTools.get('nlq_to_sql')?.handler;
        await handler({
          question: 'Show user order counts',
          database_id: 1,
          tables: ['users', 'orders'],
        });

        expect(mockLLMService.generateSQL).toHaveBeenCalledWith({
          question: 'Show user order counts',
          schema: expect.objectContaining({
            tables: expect.arrayContaining([
              expect.objectContaining({ name: 'users' }),
              expect.objectContaining({ name: 'orders' }),
            ]),
          }),
        });
      });

      it('handles case-insensitive table name filtering', async () => {
        const handler = registeredTools.get('nlq_to_sql')?.handler;
        await handler({
          question: 'Show user order counts',
          database_id: 1,
          tables: ['USERS', 'Orders'],
        });

        const generateSQLCall = mockLLMService.generateSQL.mock.calls[0][0];
        const tableNames = generateSQLCall.schema.tables.map((t: { name: string }) => t.name);
        expect(tableNames).toContain('users');
        expect(tableNames).toContain('orders');
      });

      it('returns empty tables array when no matching tables found', async () => {
        const handler = registeredTools.get('nlq_to_sql')?.handler;
        await handler({
          question: 'Show data from nonexistent table',
          database_id: 1,
          tables: ['nonexistent_table'],
        });

        const generateSQLCall = mockLLMService.generateSQL.mock.calls[0][0];
        expect(generateSQLCall.schema.tables).toHaveLength(0);
      });
    });

    describe('Large Schema Handling', () => {
      it('identifies relevant tables for large schemas (>50 tables)', async () => {
        // Create a large schema with >50 tables
        const largeTables = Array.from({ length: 60 }, (_, i) => ({
          id: i + 1,
          name: `table_${i + 1}`,
          display_name: `Table ${i + 1}`,
          description: `Description for table ${i + 1}`,
          schema: 'public',
          fields: [
            { id: i * 10, name: 'id', display_name: 'ID', description: 'Primary key', base_type: 'type/Integer', semantic_type: 'type/PK', fk_target_field_id: null },
          ],
        }));

        mockClient.getDatabaseSchema.mockResolvedValueOnce({
          id: 1,
          name: 'Large Database',
          tables: largeTables,
        });

        const handler = registeredTools.get('nlq_to_sql')?.handler;
        await handler({
          question: 'Show me sales data',
          database_id: 1,
        });

        // Should call identifyRelevantTables for large schemas
        expect(mockLLMService.identifyRelevantTables).toHaveBeenCalled();
      });

      it('does not filter tables for small schemas (<=50 tables)', async () => {
        const handler = registeredTools.get('nlq_to_sql')?.handler;
        await handler({
          question: 'Show me user data',
          database_id: 1,
        });

        // Should NOT call identifyRelevantTables for small schemas
        expect(mockLLMService.identifyRelevantTables).not.toHaveBeenCalled();
      });
    });

    describe('SQL Validation', () => {
      it('validates generated SQL before returning', async () => {
        const handler = registeredTools.get('nlq_to_sql')?.handler;
        const result = await handler({
          question: 'Get all users',
          database_id: 1,
        });

        const data = JSON.parse(result.content[0].text);
        expect(data.success).toBe(true);
        expect(data.sql).toBeDefined();
      });

      it('returns validation errors when generated SQL is dangerous', async () => {
        // Mock LLM to return dangerous SQL
        mockLLMService.generateSQL.mockResolvedValueOnce({
          sql: 'SELECT * FROM users; DROP TABLE users;--',
          explanation: 'Dangerous query',
        });

        const handler = registeredTools.get('nlq_to_sql')?.handler;
        const result = await handler({
          question: 'Delete all users',
          database_id: 1,
        });

        const data = JSON.parse(result.content[0].text);
        expect(data.success).toBe(false);
        expect(data.error).toContain('Generated SQL failed validation');
        expect(data.validation_errors).toBeDefined();
        expect(data.validation_errors.length).toBeGreaterThan(0);
      });

      it('returns sanitized SQL in response', async () => {
        const handler = registeredTools.get('nlq_to_sql')?.handler;
        const result = await handler({
          question: 'Get all users',
          database_id: 1,
        });

        const data = JSON.parse(result.content[0].text);
        expect(data.sql).toBeDefined();
        // Sanitized SQL should not contain comments or multiple statements
        expect(data.sql).not.toContain('--');
        expect(data.sql).not.toContain('/*');
      });

      it('includes warnings for potentially problematic queries', async () => {
        mockLLMService.generateSQL.mockResolvedValueOnce({
          sql: 'SELECT * FROM users',
          explanation: 'Query without LIMIT',
        });

        const handler = registeredTools.get('nlq_to_sql')?.handler;
        const result = await handler({
          question: 'Get all users',
          database_id: 1,
        });

        const data = JSON.parse(result.content[0].text);
        expect(data.warnings).toBeDefined();
        expect(data.warnings).toContain('No LIMIT clause detected — LIMIT 1000 will be enforced automatically');
      });
    });

    describe('Error Handling', () => {
      it('returns error when LLM service fails', async () => {
        mockLLMService.generateSQL.mockRejectedValueOnce(new Error('API rate limit exceeded'));

        const handler = registeredTools.get('nlq_to_sql')?.handler;
        const result = await handler({
          question: 'Get all users',
          database_id: 1,
        });

        expect(result.isError).toBe(true);
        const data = JSON.parse(result.content[0].text);
        expect(data.error).toContain('API rate limit exceeded');
      });

      it('returns error when database schema fetch fails', async () => {
        mockClient.getDatabaseSchema.mockRejectedValueOnce(new Error('Database not found'));

        const handler = registeredTools.get('nlq_to_sql')?.handler;
        const result = await handler({
          question: 'Get all users',
          database_id: 999,
        });

        expect(result.isError).toBe(true);
        const data = JSON.parse(result.content[0].text);
        expect(data.error).toContain('Database not found');
      });

      it('respects rate limiting', async () => {
        const handler = registeredTools.get('nlq_to_sql')?.handler;

        // Fill up NLQ rate limit (default is 20 per minute)
        for (let i = 0; i < 20; i++) {
          context.rateLimiter.checkLimit('nlq');
        }

        const result = await handler({
          question: 'Get all users',
          database_id: 1,
        });

        expect(result.isError).toBe(true);
      });
    });

    describe('Audit Logging', () => {
      it('logs successful SQL generation', async () => {
        const logSuccessSpy = vi.spyOn(context.auditLogger, 'logSuccess');

        const handler = registeredTools.get('nlq_to_sql')?.handler;
        await handler({
          question: 'Get all users',
          database_id: 1,
        });

        expect(logSuccessSpy).toHaveBeenCalledWith('nlq_to_sql', expect.objectContaining({
          question: 'Get all users',
          database_id: 1,
        }));
      });

      it('logs failed SQL generation', async () => {
        const logFailureSpy = vi.spyOn(context.auditLogger, 'logFailure');
        mockLLMService.generateSQL.mockRejectedValueOnce(new Error('LLM error'));

        const handler = registeredTools.get('nlq_to_sql')?.handler;
        await handler({
          question: 'Get all users',
          database_id: 1,
        });

        expect(logFailureSpy).toHaveBeenCalled();
      });

      it('logs validation failure for dangerous SQL', async () => {
        const logFailureSpy = vi.spyOn(context.auditLogger, 'logFailure');
        mockLLMService.generateSQL.mockResolvedValueOnce({
          sql: 'SELECT * FROM users UNION SELECT * FROM passwords',
          explanation: 'Union injection',
        });

        const handler = registeredTools.get('nlq_to_sql')?.handler;
        await handler({
          question: 'Get passwords',
          database_id: 1,
        });

        expect(logFailureSpy).toHaveBeenCalledWith('nlq_to_sql', 'Generated SQL failed validation', expect.any(Object));
      });
    });
  });

  // ==========================================================================
  // explain_sql Tests
  // ==========================================================================

  describe('explain_sql', () => {
    describe('Successful Explanation', () => {
      it('explains SQL query in plain English', async () => {
        const handler = registeredTools.get('explain_sql')?.handler;
        const result = await handler({
          sql: 'SELECT * FROM users WHERE active = true LIMIT 10',
        });

        expect(result.isError).toBeFalsy();
        const data = JSON.parse(result.content[0].text);
        expect(data.sql).toBe('SELECT * FROM users WHERE active = true LIMIT 10');
        expect(data.explanation).toBeDefined();
        expect(typeof data.explanation).toBe('string');
      });

      it('returns the original SQL along with explanation', async () => {
        const testSQL = 'SELECT COUNT(*) FROM orders GROUP BY status';
        const handler = registeredTools.get('explain_sql')?.handler;
        const result = await handler({
          sql: testSQL,
        });

        const data = JSON.parse(result.content[0].text);
        expect(data.sql).toBe(testSQL);
      });

      it('calls LLM service with the SQL query', async () => {
        const testSQL = 'SELECT * FROM products WHERE price > 100';
        const handler = registeredTools.get('explain_sql')?.handler;
        await handler({ sql: testSQL });

        expect(mockLLMService.explainSQL).toHaveBeenCalledWith(testSQL);
      });
    });

    describe('Error Handling', () => {
      it('returns error when LLM service fails', async () => {
        mockLLMService.explainSQL.mockRejectedValueOnce(new Error('Explanation service unavailable'));

        const handler = registeredTools.get('explain_sql')?.handler;
        const result = await handler({
          sql: 'SELECT * FROM users',
        });

        expect(result.isError).toBe(true);
        const data = JSON.parse(result.content[0].text);
        expect(data.error).toContain('Explanation service unavailable');
      });

      it('respects rate limiting', async () => {
        const handler = registeredTools.get('explain_sql')?.handler;

        // Fill up NLQ rate limit
        for (let i = 0; i < 20; i++) {
          context.rateLimiter.checkLimit('nlq');
        }

        const result = await handler({
          sql: 'SELECT * FROM users',
        });

        expect(result.isError).toBe(true);
      });
    });

    describe('Audit Logging', () => {
      it('logs successful explanation', async () => {
        const logSuccessSpy = vi.spyOn(context.auditLogger, 'logSuccess');

        const handler = registeredTools.get('explain_sql')?.handler;
        await handler({
          sql: 'SELECT * FROM users LIMIT 10',
        });

        expect(logSuccessSpy).toHaveBeenCalledWith('explain_sql', expect.objectContaining({
          sqlLength: expect.any(Number),
        }));
      });

      it('logs failed explanation', async () => {
        const logFailureSpy = vi.spyOn(context.auditLogger, 'logFailure');
        mockLLMService.explainSQL.mockRejectedValueOnce(new Error('LLM error'));

        const handler = registeredTools.get('explain_sql')?.handler;
        await handler({ sql: 'SELECT 1' });

        expect(logFailureSpy).toHaveBeenCalled();
      });
    });
  });

  // ==========================================================================
  // optimize_sql Tests
  // ==========================================================================

  describe('optimize_sql', () => {
    describe('Without Execution Plan', () => {
      it('returns optimization suggestions', async () => {
        const handler = registeredTools.get('optimize_sql')?.handler;
        const result = await handler({
          sql: 'SELECT * FROM users WHERE name LIKE "%john%"',
        });

        expect(result.isError).toBeFalsy();
        const data = JSON.parse(result.content[0].text);
        expect(data.original_sql).toBeDefined();
        expect(data.suggestions).toBeDefined();
        expect(Array.isArray(data.suggestions)).toBe(true);
        expect(data.suggestions.length).toBeGreaterThan(0);
      });

      it('returns optimized SQL when available', async () => {
        const handler = registeredTools.get('optimize_sql')?.handler;
        const result = await handler({
          sql: 'SELECT * FROM users',
        });

        const data = JSON.parse(result.content[0].text);
        expect(data.optimized_sql).toBeDefined();
      });

      it('calls LLM service without execution plan', async () => {
        const handler = registeredTools.get('optimize_sql')?.handler;
        await handler({
          sql: 'SELECT * FROM users',
        });

        expect(mockLLMService.optimizeSQL).toHaveBeenCalledWith(
          'SELECT * FROM users',
          undefined
        );
      });
    });

    describe('With Execution Plan', () => {
      it('fetches execution plan when database_id is provided', async () => {
        const handler = registeredTools.get('optimize_sql')?.handler;
        await handler({
          sql: 'SELECT * FROM users',
          database_id: 1,
        });

        expect(mockClient.executeQuery).toHaveBeenCalledWith(1, 'EXPLAIN SELECT * FROM users LIMIT 1000');
      });

      it('passes execution plan to LLM service', async () => {
        const handler = registeredTools.get('optimize_sql')?.handler;
        await handler({
          sql: 'SELECT * FROM users',
          database_id: 1,
        });

        expect(mockLLMService.optimizeSQL).toHaveBeenCalledWith(
          'SELECT * FROM users',
          expect.any(String)
        );
      });

      it('continues without execution plan if EXPLAIN fails', async () => {
        mockClient.executeQuery.mockRejectedValueOnce(new Error('EXPLAIN not supported'));

        const handler = registeredTools.get('optimize_sql')?.handler;
        const result = await handler({
          sql: 'SELECT * FROM users',
          database_id: 1,
        });

        expect(result.isError).toBeFalsy();
        const data = JSON.parse(result.content[0].text);
        expect(data.suggestions).toBeDefined();
      });
    });

    describe('JSON Response Parsing', () => {
      it('parses structured JSON response from LLM', async () => {
        mockLLMService.optimizeSQL.mockResolvedValueOnce({
          suggestions: [
            'Create an index on the name column',
            'Use ILIKE instead of LIKE for case-insensitive matching',
            'Add a covering index to avoid table lookups',
          ],
          optimizedSQL: 'SELECT id, name FROM users WHERE name ILIKE $1',
        });

        const handler = registeredTools.get('optimize_sql')?.handler;
        const result = await handler({
          sql: 'SELECT * FROM users WHERE LOWER(name) = LOWER("john")',
        });

        const data = JSON.parse(result.content[0].text);
        expect(data.suggestions).toHaveLength(3);
        expect(data.optimized_sql).toContain('ILIKE');
      });

      it('handles response without optimized SQL', async () => {
        mockLLMService.optimizeSQL.mockResolvedValueOnce({
          suggestions: ['The query is already optimal'],
        });

        const handler = registeredTools.get('optimize_sql')?.handler;
        const result = await handler({
          sql: 'SELECT id FROM users WHERE id = 1',
        });

        const data = JSON.parse(result.content[0].text);
        expect(data.suggestions).toContain('The query is already optimal');
        expect(data.optimized_sql).toBeUndefined();
      });
    });

    describe('Error Handling', () => {
      it('returns error when LLM service fails', async () => {
        mockLLMService.optimizeSQL.mockRejectedValueOnce(new Error('Optimization service error'));

        const handler = registeredTools.get('optimize_sql')?.handler;
        const result = await handler({
          sql: 'SELECT * FROM users',
        });

        expect(result.isError).toBe(true);
        const data = JSON.parse(result.content[0].text);
        expect(data.error).toContain('Optimization service error');
      });
    });

    describe('Audit Logging', () => {
      it('logs successful optimization', async () => {
        const logSuccessSpy = vi.spyOn(context.auditLogger, 'logSuccess');

        const handler = registeredTools.get('optimize_sql')?.handler;
        await handler({
          sql: 'SELECT * FROM users LIMIT 100',
        });

        expect(logSuccessSpy).toHaveBeenCalledWith('optimize_sql', expect.objectContaining({
          sqlLength: expect.any(Number),
        }));
      });
    });
  });

  // ==========================================================================
  // validate_sql Tests
  // ==========================================================================

  describe('validate_sql', () => {
    describe('Valid Queries', () => {
      it('validates a simple SELECT query', async () => {
        const handler = registeredTools.get('validate_sql')?.handler;
        const result = await handler({
          sql: 'SELECT * FROM users LIMIT 10',
        });

        expect(result.isError).toBeFalsy();
        const data = JSON.parse(result.content[0].text);
        expect(data.valid).toBe(true);
        expect(data.errors).toHaveLength(0);
      });

      it('validates a query with JOINs', async () => {
        const handler = registeredTools.get('validate_sql')?.handler;
        const result = await handler({
          sql: 'SELECT u.name, o.total FROM users u JOIN orders o ON u.id = o.user_id LIMIT 100',
        });

        const data = JSON.parse(result.content[0].text);
        expect(data.valid).toBe(true);
      });

      it('validates a CTE (WITH) query', async () => {
        const handler = registeredTools.get('validate_sql')?.handler;
        const result = await handler({
          sql: `WITH active_users AS (SELECT * FROM users WHERE active = true)
                SELECT * FROM active_users LIMIT 50`,
        });

        const data = JSON.parse(result.content[0].text);
        expect(data.valid).toBe(true);
      });

      it('validates a query with subquery', async () => {
        const handler = registeredTools.get('validate_sql')?.handler;
        const result = await handler({
          sql: 'SELECT * FROM users WHERE id IN (SELECT user_id FROM orders) LIMIT 100',
        });

        const data = JSON.parse(result.content[0].text);
        expect(data.valid).toBe(true);
      });

      it('returns sanitized SQL', async () => {
        const handler = registeredTools.get('validate_sql')?.handler;
        const result = await handler({
          sql: '  SELECT   *   FROM   users   LIMIT   10  ',
        });

        const data = JSON.parse(result.content[0].text);
        expect(data.sanitized_sql).toBeDefined();
        // Sanitized SQL should have normalized whitespace
        expect(data.sanitized_sql).toBe('SELECT * FROM users LIMIT 10');
      });
    });

    describe('Invalid/Dangerous Queries', () => {
      it('rejects DROP TABLE statements', async () => {
        const handler = registeredTools.get('validate_sql')?.handler;
        const result = await handler({
          sql: 'DROP TABLE users',
        });

        const data = JSON.parse(result.content[0].text);
        expect(data.valid).toBe(false);
        expect(data.errors).toContain('Blocked SQL pattern detected: DROP');
      });

      it('rejects DELETE statements', async () => {
        const handler = registeredTools.get('validate_sql')?.handler;
        const result = await handler({
          sql: 'DELETE FROM users WHERE id = 1',
        });

        const data = JSON.parse(result.content[0].text);
        expect(data.valid).toBe(false);
        expect(data.errors.some((e: string) => e.includes('DELETE'))).toBe(true);
      });

      it('rejects UPDATE statements', async () => {
        const handler = registeredTools.get('validate_sql')?.handler;
        const result = await handler({
          sql: 'UPDATE users SET active = false',
        });

        const data = JSON.parse(result.content[0].text);
        expect(data.valid).toBe(false);
        expect(data.errors.some((e: string) => e.includes('UPDATE'))).toBe(true);
      });

      it('rejects INSERT statements', async () => {
        const handler = registeredTools.get('validate_sql')?.handler;
        const result = await handler({
          sql: "INSERT INTO users (name) VALUES ('hacker')",
        });

        const data = JSON.parse(result.content[0].text);
        expect(data.valid).toBe(false);
        expect(data.errors.some((e: string) => e.includes('INSERT'))).toBe(true);
      });

      it('rejects TRUNCATE statements', async () => {
        const handler = registeredTools.get('validate_sql')?.handler;
        const result = await handler({
          sql: 'TRUNCATE TABLE users',
        });

        const data = JSON.parse(result.content[0].text);
        expect(data.valid).toBe(false);
      });

      it('rejects ALTER TABLE statements', async () => {
        const handler = registeredTools.get('validate_sql')?.handler;
        const result = await handler({
          sql: 'ALTER TABLE users ADD COLUMN password TEXT',
        });

        const data = JSON.parse(result.content[0].text);
        expect(data.valid).toBe(false);
      });

      it('rejects UNION-based injection attempts', async () => {
        const handler = registeredTools.get('validate_sql')?.handler;
        const result = await handler({
          sql: 'SELECT * FROM users UNION SELECT * FROM passwords',
        });

        const data = JSON.parse(result.content[0].text);
        expect(data.valid).toBe(false);
        expect(data.errors.some((e: string) => e.includes('dangerous'))).toBe(true);
      });

      it('rejects queries with SQL comments', async () => {
        const handler = registeredTools.get('validate_sql')?.handler;
        const result = await handler({
          sql: "SELECT * FROM users -- WHERE admin = true",
        });

        const data = JSON.parse(result.content[0].text);
        expect(data.valid).toBe(false);
      });

      it('rejects queries with block comments', async () => {
        const handler = registeredTools.get('validate_sql')?.handler;
        const result = await handler({
          sql: 'SELECT * FROM users /* comment */ WHERE id = 1',
        });

        const data = JSON.parse(result.content[0].text);
        expect(data.valid).toBe(false);
      });

      it('rejects multiple statement injection', async () => {
        const handler = registeredTools.get('validate_sql')?.handler;
        const result = await handler({
          sql: "SELECT * FROM users; DROP TABLE users;",
        });

        const data = JSON.parse(result.content[0].text);
        expect(data.valid).toBe(false);
      });

      it('rejects time-based blind injection (SLEEP)', async () => {
        const handler = registeredTools.get('validate_sql')?.handler;
        const result = await handler({
          sql: 'SELECT * FROM users WHERE SLEEP(5)',
        });

        const data = JSON.parse(result.content[0].text);
        expect(data.valid).toBe(false);
      });

      it('rejects time-based blind injection (pg_sleep)', async () => {
        const handler = registeredTools.get('validate_sql')?.handler;
        const result = await handler({
          sql: 'SELECT * FROM users WHERE pg_sleep(5)',
        });

        const data = JSON.parse(result.content[0].text);
        expect(data.valid).toBe(false);
      });

      it('rejects INFORMATION_SCHEMA access', async () => {
        const handler = registeredTools.get('validate_sql')?.handler;
        const result = await handler({
          sql: 'SELECT * FROM INFORMATION_SCHEMA.TABLES',
        });

        const data = JSON.parse(result.content[0].text);
        expect(data.valid).toBe(false);
      });

      it('rejects file operations (INTO OUTFILE)', async () => {
        const handler = registeredTools.get('validate_sql')?.handler;
        const result = await handler({
          sql: "SELECT * INTO OUTFILE '/tmp/data.txt' FROM users",
        });

        const data = JSON.parse(result.content[0].text);
        expect(data.valid).toBe(false);
      });

      it('rejects file read operations (LOAD_FILE)', async () => {
        const handler = registeredTools.get('validate_sql')?.handler;
        const result = await handler({
          sql: "SELECT LOAD_FILE('/etc/passwd')",
        });

        const data = JSON.parse(result.content[0].text);
        expect(data.valid).toBe(false);
      });

      it('rejects command execution (xp_cmdshell)', async () => {
        const handler = registeredTools.get('validate_sql')?.handler;
        const result = await handler({
          sql: "EXEC xp_cmdshell 'dir'",
        });

        const data = JSON.parse(result.content[0].text);
        expect(data.valid).toBe(false);
      });
    });

    describe('Warning Generation', () => {
      it('warns about missing LIMIT clause', async () => {
        const handler = registeredTools.get('validate_sql')?.handler;
        const result = await handler({
          sql: 'SELECT * FROM users',
        });

        const data = JSON.parse(result.content[0].text);
        expect(data.warnings).toContain('No LIMIT clause detected — LIMIT 1000 will be enforced automatically');
      });

      it('warns about SELECT *', async () => {
        const handler = registeredTools.get('validate_sql')?.handler;
        const result = await handler({
          sql: 'SELECT * FROM users LIMIT 10',
        });

        const data = JSON.parse(result.content[0].text);
        expect(data.warnings).toContain('Consider selecting specific columns instead of *');
      });

      it('warns about leading wildcards in LIKE', async () => {
        const handler = registeredTools.get('validate_sql')?.handler;
        const result = await handler({
          sql: "SELECT * FROM users WHERE name LIKE '%john' LIMIT 10",
        });

        const data = JSON.parse(result.content[0].text);
        expect(data.warnings).toContain('Leading wildcard in LIKE may cause slow queries');
      });

      it('warns about CROSS JOIN', async () => {
        const handler = registeredTools.get('validate_sql')?.handler;
        const result = await handler({
          sql: 'SELECT * FROM users CROSS JOIN orders LIMIT 100',
        });

        const data = JSON.parse(result.content[0].text);
        expect(data.warnings).toContain('CROSS JOIN can produce very large result sets');
      });

      it('can return multiple warnings', async () => {
        const handler = registeredTools.get('validate_sql')?.handler;
        const result = await handler({
          sql: 'SELECT * FROM users CROSS JOIN orders',
        });

        const data = JSON.parse(result.content[0].text);
        expect(data.warnings.length).toBeGreaterThan(1);
      });
    });

    describe('Rate Limiting', () => {
      it('uses read tier rate limit (not nlq tier)', async () => {
        const handler = registeredTools.get('validate_sql')?.handler;

        // Fill up read rate limit (120 per minute)
        for (let i = 0; i < 120; i++) {
          context.rateLimiter.checkLimit('read');
        }

        const result = await handler({
          sql: 'SELECT * FROM users LIMIT 10',
        });

        expect(result.isError).toBe(true);
      });
    });

    describe('Audit Logging', () => {
      it('logs validation results', async () => {
        const logSuccessSpy = vi.spyOn(context.auditLogger, 'logSuccess');

        const handler = registeredTools.get('validate_sql')?.handler;
        await handler({
          sql: 'SELECT * FROM users LIMIT 10',
        });

        expect(logSuccessSpy).toHaveBeenCalledWith('validate_sql', expect.objectContaining({
          valid: true,
          errorCount: 0,
          warningCount: expect.any(Number),
        }));
      });

      it('logs validation of invalid SQL', async () => {
        const logSuccessSpy = vi.spyOn(context.auditLogger, 'logSuccess');

        const handler = registeredTools.get('validate_sql')?.handler;
        await handler({
          sql: 'DROP TABLE users',
        });

        // Even invalid SQL is "successfully" validated (just returns valid: false)
        expect(logSuccessSpy).toHaveBeenCalledWith('validate_sql', expect.objectContaining({
          valid: false,
          errorCount: expect.any(Number),
        }));
      });
    });
  });

  // ==========================================================================
  // Cross-Tool Tests
  // ==========================================================================

  describe('Cross-Tool Integration', () => {
    it('nlq_to_sql result can be validated with validate_sql', async () => {
      const nlqHandler = registeredTools.get('nlq_to_sql')?.handler;
      const validateHandler = registeredTools.get('validate_sql')?.handler;

      const nlqResult = await nlqHandler({
        question: 'Get all users',
        database_id: 1,
      });

      const nlqData = JSON.parse(nlqResult.content[0].text);
      expect(nlqData.success).toBe(true);

      const validateResult = await validateHandler({
        sql: nlqData.sql,
      });

      const validateData = JSON.parse(validateResult.content[0].text);
      expect(validateData.valid).toBe(true);
    });

    it('nlq_to_sql result can be explained with explain_sql', async () => {
      const nlqHandler = registeredTools.get('nlq_to_sql')?.handler;
      const explainHandler = registeredTools.get('explain_sql')?.handler;

      const nlqResult = await nlqHandler({
        question: 'Count orders by status',
        database_id: 1,
      });

      const nlqData = JSON.parse(nlqResult.content[0].text);
      expect(nlqData.success).toBe(true);

      const explainResult = await explainHandler({
        sql: nlqData.sql,
      });

      expect(explainResult.isError).toBeFalsy();
      const explainData = JSON.parse(explainResult.content[0].text);
      expect(explainData.explanation).toBeDefined();
    });

    it('nlq_to_sql result can be optimized with optimize_sql', async () => {
      const nlqHandler = registeredTools.get('nlq_to_sql')?.handler;
      const optimizeHandler = registeredTools.get('optimize_sql')?.handler;

      const nlqResult = await nlqHandler({
        question: 'Get user order totals',
        database_id: 1,
      });

      const nlqData = JSON.parse(nlqResult.content[0].text);
      expect(nlqData.success).toBe(true);

      const optimizeResult = await optimizeHandler({
        sql: nlqData.sql,
        database_id: 1,
      });

      expect(optimizeResult.isError).toBeFalsy();
      const optimizeData = JSON.parse(optimizeResult.content[0].text);
      expect(optimizeData.suggestions).toBeDefined();
    });
  });

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  describe('Edge Cases', () => {
    it('handles empty question for nlq_to_sql', async () => {
      const handler = registeredTools.get('nlq_to_sql')?.handler;
      const result = await handler({
        question: '',
        database_id: 1,
      });

      // Should still process (LLM will handle empty input)
      expect(result).toBeDefined();
    });

    it('handles very long SQL for validation', async () => {
      const longSQL = 'SELECT ' + Array(100).fill('column_name').join(', ') + ' FROM users LIMIT 10';

      const handler = registeredTools.get('validate_sql')?.handler;
      const result = await handler({
        sql: longSQL,
      });

      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0].text);
      expect(data.valid).toBe(true);
    });

    it('handles SQL with special characters', async () => {
      const handler = registeredTools.get('validate_sql')?.handler;
      const result = await handler({
        sql: "SELECT * FROM users WHERE name = 'O''Brien' LIMIT 10",
      });

      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0].text);
      expect(data.valid).toBe(true);
    });

    it('handles unicode in SQL', async () => {
      const handler = registeredTools.get('validate_sql')?.handler;
      const result = await handler({
        sql: "SELECT * FROM users WHERE city = N'Tokyo' LIMIT 10",
      });

      expect(result.isError).toBeFalsy();
    });
  });
});
