import { describe, it, expect } from 'vitest';
import { formatQueryResult, formatSchemaResult } from '../../../src/utils/response-formatter.js';

const testCols = [
  { name: 'id', display_name: 'ID', base_type: 'type/Integer', semantic_type: null },
  { name: 'name', display_name: 'Name', base_type: 'type/Text', semantic_type: null },
  { name: 'email', display_name: 'Email', base_type: 'type/Text', semantic_type: 'type/Email' },
  { name: 'created_at', display_name: 'Created At', base_type: 'type/DateTime', semantic_type: null },
];

const testRows: unknown[][] = [
  [1, 'Alice', 'alice@example.com', '2024-01-01'],
  [2, 'Bob', 'bob@example.com', '2024-01-02'],
  [3, 'Charlie', 'charlie@example.com', '2024-01-03'],
  [4, 'Diana', 'diana@example.com', '2024-01-04'],
  [5, 'Eve', 'eve@example.com', '2024-01-05'],
];

const testSchema = {
  tables: [
    {
      name: 'users',
      description: 'User accounts',
      columns: [
        { name: 'id', type: 'INTEGER', description: null },
        { name: 'name', type: 'TEXT', description: 'Full name' },
        { name: 'email', type: 'TEXT', description: 'Email address' },
      ],
    },
    {
      name: 'orders',
      description: 'Customer orders',
      columns: [
        { name: 'id', type: 'INTEGER', description: null },
        { name: 'user_id', type: 'INTEGER', description: 'FK to users' },
        { name: 'total', type: 'DECIMAL', description: null },
      ],
    },
    {
      name: 'products',
      description: null,
      columns: [
        { name: 'id', type: 'INTEGER', description: null },
        { name: 'name', type: 'TEXT', description: null },
      ],
    },
  ],
};

describe('formatQueryResult', () => {
  it('returns all columns and rows with no options (default behavior)', () => {
    const result = formatQueryResult(testCols, testRows, 5);

    expect(result.columns).toEqual([
      { name: 'id', type: 'type/Integer' },
      { name: 'name', type: 'type/Text' },
      { name: 'email', type: 'type/Text' },
      { name: 'created_at', type: 'type/DateTime' },
    ]);
    expect(result.rows).toEqual(testRows);
    expect(result.row_count).toBe(5);
    expect(result.has_more).toBe(false);
    expect(result.next_offset).toBeNull();
  });

  it('filters columns by fields param', () => {
    const result = formatQueryResult(testCols, testRows, 5, { fields: ['id', 'name'] });

    expect(result.columns).toEqual([
      { name: 'id', type: 'type/Integer' },
      { name: 'name', type: 'type/Text' },
    ]);
    expect(result.rows).toEqual([
      [1, 'Alice'],
      [2, 'Bob'],
      [3, 'Charlie'],
      [4, 'Diana'],
      [5, 'Eve'],
    ]);
  });

  it('ignores invalid field names (returns empty columns if none match)', () => {
    const result = formatQueryResult(testCols, testRows, 5, { fields: ['nonexistent', 'also_fake'] });

    expect(result.columns).toEqual([]);
    expect(result.rows).toEqual([[], [], [], [], []]);
  });

  it('returns string[] columns in compact format', () => {
    const result = formatQueryResult(testCols, testRows, 5, { format: 'compact' });

    expect(result.columns).toEqual(['id', 'name', 'email', 'created_at']);
    expect(result.rows).toEqual(testRows);
  });

  it('slices rows by limit and offset with correct pagination', () => {
    const result = formatQueryResult(testCols, testRows, 5, { limit: 2, offset: 1 });

    expect(result.rows).toEqual([
      [2, 'Bob', 'bob@example.com', '2024-01-02'],
      [3, 'Charlie', 'charlie@example.com', '2024-01-03'],
    ]);
    expect(result.has_more).toBe(true);
    expect(result.next_offset).toBe(3);
    expect(result.row_count).toBe(5);
  });

  it('returns has_more false when limit covers remaining rows', () => {
    const result = formatQueryResult(testCols, testRows, 5, { limit: 3, offset: 3 });

    expect(result.rows).toEqual([
      [4, 'Diana', 'diana@example.com', '2024-01-04'],
      [5, 'Eve', 'eve@example.com', '2024-01-05'],
    ]);
    expect(result.has_more).toBe(false);
    expect(result.next_offset).toBeNull();
  });

  it('returns empty rows when offset is beyond total', () => {
    const result = formatQueryResult(testCols, testRows, 5, { limit: 10, offset: 100 });

    expect(result.rows).toEqual([]);
    expect(result.has_more).toBe(false);
    expect(result.next_offset).toBeNull();
  });

  it('handles empty rows', () => {
    const result = formatQueryResult(testCols, [], 0);

    expect(result.columns).toEqual([
      { name: 'id', type: 'type/Integer' },
      { name: 'name', type: 'type/Text' },
      { name: 'email', type: 'type/Text' },
      { name: 'created_at', type: 'type/DateTime' },
    ]);
    expect(result.rows).toEqual([]);
    expect(result.row_count).toBe(0);
    expect(result.has_more).toBe(false);
    expect(result.next_offset).toBeNull();
  });

  it('compact output is meaningfully smaller than default', () => {
    const defaultResult = formatQueryResult(testCols, testRows, 5, { format: 'default' });
    const compactResult = formatQueryResult(testCols, testRows, 5, { format: 'compact' });

    const defaultSize = JSON.stringify(defaultResult, null, 2).length;
    const compactSize = JSON.stringify(compactResult).length;

    expect(compactSize).toBeLessThan(defaultSize);
  });
});

describe('formatSchemaResult', () => {
  it('returns tables_only with no columns', () => {
    const result = formatSchemaResult(testSchema, { detail: 'tables_only' }) as { tables: Array<{ name: string; columns?: unknown }> };

    expect(result.tables).toHaveLength(3);
    expect(result.tables[0]).toEqual({ name: 'users', description: 'User accounts' });
    expect(result.tables[0]).not.toHaveProperty('columns');
  });

  it('filters to specific tables', () => {
    const result = formatSchemaResult(testSchema, { tables: ['users', 'products'] }) as { tables: Array<{ name: string }> };

    expect(result.tables).toHaveLength(2);
    expect(result.tables.map(t => t.name)).toEqual(['users', 'products']);
  });

  it('strips null descriptions in compact format', () => {
    const result = formatSchemaResult(testSchema, { format: 'compact' }) as {
      tables: Array<{ columns: Array<{ name: string; description?: string | null }> }>;
    };

    // The 'products' table has all null descriptions on columns
    const productsTable = result.tables.find(t => (t as unknown as { name: string }).name === 'products')!;
    for (const col of productsTable.columns) {
      expect(col).not.toHaveProperty('description');
    }

    // The 'users' table has 'name' column with description 'Full name' - should be kept
    const usersTable = result.tables.find(t => (t as unknown as { name: string }).name === 'users')!;
    const nameCol = usersTable.columns.find(c => c.name === 'name')!;
    expect(nameCol.description).toBe('Full name');
  });

  it('returns all data in default full mode', () => {
    const result = formatSchemaResult(testSchema) as {
      tables: Array<{
        name: string;
        description: string | null;
        columns: Array<{ name: string; type: string; description: string | null }>;
      }>;
    };

    expect(result.tables).toHaveLength(3);
    expect(result.tables[0].columns).toHaveLength(3);
    // Null descriptions should be preserved as null in default mode
    expect(result.tables[0].columns[0].description).toBeNull();
  });

  it('combines tables filter with tables_only detail', () => {
    const result = formatSchemaResult(testSchema, {
      detail: 'tables_only',
      tables: ['orders'],
    }) as { tables: Array<{ name: string; description: string | null }> };

    expect(result.tables).toHaveLength(1);
    expect(result.tables[0]).toEqual({ name: 'orders', description: 'Customer orders' });
  });
});
