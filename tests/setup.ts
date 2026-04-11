/**
 * Test Setup
 * Common utilities and configuration for tests
 */

import { vi } from 'vitest';

// Mock console methods to reduce noise in tests
export function silenceConsole() {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'debug').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
}

// Restore console
export function restoreConsole() {
  vi.restoreAllMocks();
}

// Create mock Metabase client responses
export const mockResponses = {
  dashboards: [
    { id: 1, name: 'Sales Dashboard', description: 'Sales metrics', collection_id: 1, archived: false },
    { id: 2, name: 'Marketing Dashboard', description: null, collection_id: 1, archived: false },
  ],
  cards: [
    { id: 1, name: 'Monthly Revenue', description: 'Revenue by month', display: 'line', database_id: 1, collection_id: 1, archived: false },
    { id: 2, name: 'User Count', description: null, display: 'scalar', database_id: 1, collection_id: 1, archived: false },
  ],
  databases: [
    { id: 1, name: 'Production', description: 'Main database', engine: 'postgres', is_sample: false },
    { id: 2, name: 'Sample Database', description: 'Sample data', engine: 'h2', is_sample: true },
  ],
  collections: [
    { id: 1, name: 'Analytics', description: 'Analytics collection', color: '#509EE3', archived: false, location: '/' },
    { id: 2, name: 'Marketing', description: null, color: '#88BF4D', archived: false, location: '/' },
  ],
  queryResult: {
    data: {
      rows: [[1, 'Test', 100], [2, 'Test2', 200]],
      cols: [
        { name: 'id', display_name: 'ID', base_type: 'type/Integer', semantic_type: null },
        { name: 'name', display_name: 'Name', base_type: 'type/Text', semantic_type: null },
        { name: 'value', display_name: 'Value', base_type: 'type/Integer', semantic_type: null },
      ],
    },
    database_id: 1,
    started_at: '2024-01-01T00:00:00Z',
    json_query: { type: 'native', database: 1, native: { query: 'SELECT * FROM test' } },
    average_execution_time: 100,
    status: 'completed' as const,
    context: 'ad-hoc',
    row_count: 2,
    running_time: 50,
  },
  databaseMetadata: {
    id: 1,
    name: 'Production',
    tables: [
      {
        id: 1,
        name: 'users',
        display_name: 'Users',
        description: 'User accounts',
        schema: 'public',
        fields: [
          { id: 1, name: 'id', display_name: 'ID', description: 'Primary key', base_type: 'type/Integer', semantic_type: 'type/PK', fk_target_field_id: null },
          { id: 2, name: 'email', display_name: 'Email', description: 'User email', base_type: 'type/Text', semantic_type: 'type/Email', fk_target_field_id: null },
          { id: 3, name: 'created_at', display_name: 'Created At', description: null, base_type: 'type/DateTime', semantic_type: null, fk_target_field_id: null },
        ],
      },
      {
        id: 2,
        name: 'orders',
        display_name: 'Orders',
        description: 'Customer orders',
        schema: 'public',
        fields: [
          { id: 4, name: 'id', display_name: 'ID', description: null, base_type: 'type/Integer', semantic_type: 'type/PK', fk_target_field_id: null },
          { id: 5, name: 'user_id', display_name: 'User ID', description: 'Foreign key to users', base_type: 'type/Integer', semantic_type: 'type/FK', fk_target_field_id: 1 },
          { id: 6, name: 'total', display_name: 'Total', description: 'Order total', base_type: 'type/Decimal', semantic_type: null, fk_target_field_id: null },
          { id: 7, name: 'created_at', display_name: 'Created At', description: null, base_type: 'type/DateTime', semantic_type: null, fk_target_field_id: null },
        ],
      },
    ],
  },
};

// SQL injection test payloads
// Note: "OR 1=1" is not an injection when user controls full query - only blocked patterns matter
export const sqlInjectionPayloads = [
  // Basic injection
  "SELECT * FROM users; DROP TABLE users;--",
  "SELECT * FROM users UNION SELECT * FROM passwords",

  // Comment-based
  "SELECT * FROM users /* comment */ WHERE admin = true",
  "SELECT * FROM users -- comment",

  // Time-based blind
  "SELECT * FROM users WHERE SLEEP(5)",
  "SELECT * FROM users WHERE BENCHMARK(1000000,SHA1('test'))",
  "SELECT * FROM users; WAITFOR DELAY '0:0:5'",
  "SELECT * FROM users WHERE pg_sleep(5)",

  // File operations
  "SELECT * INTO OUTFILE '/tmp/test.txt' FROM users",
  "SELECT LOAD_FILE('/etc/passwd')",
  "SELECT * INTO DUMPFILE '/tmp/dump' FROM users",

  // Schema enumeration
  "SELECT * FROM INFORMATION_SCHEMA.TABLES",
  "SELECT * FROM sys.tables",

  // Command execution
  "EXEC xp_cmdshell 'dir'",
  "EXEC sp_executesql N'SELECT * FROM users'",

  // Multi-statement
  "SELECT 1; INSERT INTO users VALUES (1, 'hacker')",
  "SELECT 1; UPDATE users SET admin = true",
  "SELECT 1; DELETE FROM users",

  // UNION injection variations
  "SELECT * FROM users UNION ALL SELECT * FROM admins",
  "SELECT * FROM users UNION SELECT NULL, NULL, NULL",
];

// Valid SQL queries for testing
export const validSQLQueries = [
  "SELECT * FROM users LIMIT 10",
  "SELECT id, name FROM products WHERE price > 100",
  "SELECT COUNT(*) FROM orders GROUP BY status",
  "WITH recent_orders AS (SELECT * FROM orders WHERE created_at > NOW() - INTERVAL '7 days') SELECT * FROM recent_orders",
  "SELECT u.name, COUNT(o.id) FROM users u LEFT JOIN orders o ON u.id = o.user_id GROUP BY u.name",
];

// Create a mock Metabase client
export function createMockMetabaseClient() {
  return {
    getDashboards: vi.fn().mockResolvedValue(mockResponses.dashboards),
    getDashboard: vi.fn().mockResolvedValue(mockResponses.dashboards[0]),
    getCards: vi.fn().mockResolvedValue(mockResponses.cards),
    getCard: vi.fn().mockResolvedValue(mockResponses.cards[0]),
    executeCard: vi.fn().mockResolvedValue(mockResponses.queryResult),
    getDatabases: vi.fn().mockResolvedValue(mockResponses.databases),
    getDatabase: vi.fn().mockResolvedValue(mockResponses.databases[0]),
    getDatabaseSchema: vi.fn().mockResolvedValue(mockResponses.databaseMetadata),
    executeQuery: vi.fn().mockResolvedValue(mockResponses.queryResult),
    getCollections: vi.fn().mockResolvedValue(mockResponses.collections),
    getCollection: vi.fn().mockResolvedValue(mockResponses.collections[0]),
    search: vi.fn().mockResolvedValue([]),
    createCard: vi.fn().mockResolvedValue({ id: 10, ...mockResponses.cards[0] }),
    updateCard: vi.fn().mockResolvedValue(mockResponses.cards[0]),
    deleteCard: vi.fn().mockResolvedValue(undefined),
    createDashboard: vi.fn().mockResolvedValue({ id: 10, ...mockResponses.dashboards[0] }),
    updateDashboard: vi.fn().mockResolvedValue(mockResponses.dashboards[0]),
    deleteDashboard: vi.fn().mockResolvedValue(undefined),
    createCollection: vi.fn().mockResolvedValue({ id: 10, ...mockResponses.collections[0] }),
    addCardToDashboard: vi.fn().mockResolvedValue(undefined),
    removeCardFromDashboard: vi.fn().mockResolvedValue(undefined),
    healthCheck: vi.fn().mockResolvedValue(true),
  };
}

// Create test app config
export function createTestConfig() {
  return {
    mode: 'full' as const,
    metabase: {
      url: 'https://metabase.test.com',
      apiKey: 'test-api-key',
      timeout: 30000,
      maxRows: 10000,
      authMode: 'api-key' as const,
      metabaseSessionTimeoutMs: 14 * 24 * 60 * 60 * 1000,
    },
    anthropicApiKey: 'test-anthropic-key',
    llm: {
      model: 'claude-sonnet-4-20250514',
      dailyTokenLimit: 100000,
      monthlyTokenLimit: 2000000,
      retryAttempts: 3,
      retryDelayMs: 1000,
      timeoutMs: 30000,
    },
    security: {
      allowedSqlPatterns: ['SELECT', 'WITH'],
      blockedPatterns: ['DROP', 'TRUNCATE', 'DELETE', 'UPDATE', 'INSERT', 'ALTER', 'CREATE', 'GRANT', 'REVOKE', 'EXEC', 'EXECUTE'],
      rateLimit: {
        requestsPerMinute: 60,
      },
    },
    logging: {
      level: 'error' as const,
    },
  };
}
