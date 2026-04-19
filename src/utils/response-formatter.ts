/**
 * Response Formatter
 * Utilities for formatting query and schema results with token optimization
 */

import type { ColumnInfo, DatabaseSchema } from '../client/types.js';

export interface ResponseFormatOptions {
  fields?: string[];           // Column names to include (default: all)
  format?: 'default' | 'compact';  // compact = no indent, minimal metadata
  limit?: number;              // Max rows (default: all)
  offset?: number;             // Row offset for pagination (default: 0)
}

export interface SchemaFormatOptions {
  detail?: 'full' | 'tables_only';  // tables_only skips columns
  format?: 'default' | 'compact';
  tables?: string[];                // Filter to specific tables
}

interface DefaultQueryResultColumn {
  name: string;
  type: string;
}

interface DefaultQueryResult {
  columns: DefaultQueryResultColumn[];
  rows: unknown[][];
  row_count: number;
  has_more: boolean;
  next_offset: number | null;
}

interface CompactQueryResult {
  columns: string[];
  rows: unknown[][];
  row_count: number;
  has_more: boolean;
  next_offset: number | null;
}

export type FormattedQueryResult = DefaultQueryResult | CompactQueryResult;

/**
 * Format query results with optional column filtering, pagination, and compact mode.
 */
export function formatQueryResult(
  cols: ColumnInfo[],
  rows: unknown[][],
  totalRowCount: number,
  options: ResponseFormatOptions = {}
): FormattedQueryResult {
  const { fields, format = 'default', offset = 0 } = options;
  const limit = options.limit;

  // Determine which column indices to include
  let selectedIndices: number[];
  let selectedCols: ColumnInfo[];

  if (fields && fields.length > 0) {
    selectedIndices = [];
    selectedCols = [];
    for (const field of fields) {
      const idx = cols.findIndex(c => c.name === field);
      if (idx !== -1) {
        selectedIndices.push(idx);
        selectedCols.push(cols[idx]);
      }
    }
  } else {
    selectedIndices = cols.map((_, i) => i);
    selectedCols = cols;
  }

  // Apply offset and limit to rows
  const slicedRows = limit !== undefined
    ? rows.slice(offset, offset + limit)
    : rows.slice(offset);

  // Project rows to selected columns
  const projectedRows = selectedIndices.length === cols.length
    ? slicedRows
    : slicedRows.map(row => selectedIndices.map(i => row[i]));

  // Calculate pagination
  const totalAvailable = rows.length;
  const endIndex = limit !== undefined ? offset + limit : totalAvailable;
  const hasMore = endIndex < totalAvailable;
  const nextOffset = hasMore ? endIndex : null;

  if (format === 'compact') {
    return {
      columns: selectedCols.map(c => c.name),
      rows: projectedRows,
      row_count: totalRowCount,
      has_more: hasMore,
      next_offset: nextOffset,
    };
  }

  return {
    columns: selectedCols.map(c => ({ name: c.name, type: c.base_type })),
    rows: projectedRows,
    row_count: totalRowCount,
    has_more: hasMore,
    next_offset: nextOffset,
  };
}

/**
 * Format schema results with optional table filtering, detail level, and compact mode.
 */
export function formatSchemaResult(
  schema: DatabaseSchema,
  options: SchemaFormatOptions = {}
): unknown {
  const { detail = 'full', format = 'default', tables: tableFilter } = options;

  // Filter tables if specified
  let filteredTables = schema.tables;
  if (tableFilter && tableFilter.length > 0) {
    filteredTables = schema.tables.filter(t => tableFilter.includes(t.name));
  }

  if (detail === 'tables_only') {
    return {
      tables: filteredTables.map(t => ({
        name: t.name,
        description: t.description,
      })),
    };
  }

  // full detail
  if (format === 'compact') {
    return {
      tables: filteredTables.map(t => ({
        name: t.name,
        description: t.description,
        columns: t.columns.map(c => {
          const col: { name: string; type: string; description?: string } = {
            name: c.name,
            type: c.type,
          };
          if (c.description != null) {
            col.description = c.description;
          }
          return col;
        }),
      })),
    };
  }

  // default format, full detail — return filtered but otherwise as-is
  return {
    tables: filteredTables.map(t => ({
      name: t.name,
      description: t.description ?? null,
      columns: t.columns.map(c => ({
        name: c.name,
        type: c.type,
        description: c.description ?? null,
      })),
    })),
  };
}
