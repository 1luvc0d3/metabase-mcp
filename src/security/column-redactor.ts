/**
 * Column Redactor
 * Masks or drops configured columns in query results before they reach the
 * MCP client or the in-server LLM, and strips Metabase metadata that would
 * otherwise leak values of those columns (fingerprints, result insights).
 *
 * Matching is by result column name, so it guards against accidental
 * exposure (SELECT *, SELECT email, ...). A query can rename a column with
 * an alias and bypass it — hard boundaries belong in Metabase permissions
 * or database views.
 */

import type { QueryResult } from '../client/types.js';

export type RedactionMode = 'mask' | 'drop';

export const REDACTED_VALUE = '[REDACTED]';

export interface RedactionSummary {
  columns: string[];
  cells: number;
  mode: RedactionMode;
}

export interface ColumnRedactorOptions {
  /** Column name patterns, case-insensitive, `*` matches any run of characters */
  columns: string[];
  mode?: RedactionMode;
  /** Called after a query result had at least one column redacted */
  onRedact?: (summary: RedactionSummary) => void;
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`, 'i');
}

export class ColumnRedactor {
  private readonly patterns: RegExp[];
  private readonly mode: RedactionMode;
  private readonly onRedact?: (summary: RedactionSummary) => void;

  constructor(options: ColumnRedactorOptions) {
    this.patterns = options.columns.map(globToRegExp);
    this.mode = options.mode ?? 'mask';
    this.onRedact = options.onRedact;
  }

  get enabled(): boolean {
    return this.patterns.length > 0;
  }

  matches(columnName: unknown): boolean {
    return typeof columnName === 'string' && this.patterns.some(p => p.test(columnName));
  }

  /**
   * Redact a query result in place and return it.
   */
  redactQueryResult(result: QueryResult): QueryResult {
    const data = result?.data;
    if (!this.enabled || !data || !Array.isArray(data.cols)) return result;

    const indices = data.cols
      .map((col, i) => (this.matches(col.name) ? i : -1))
      .filter(i => i !== -1);
    if (indices.length === 0) return result;

    const columns = indices.map(i => data.cols[i].name);
    const rows = Array.isArray(data.rows) ? data.rows : [];
    let cells = 0;

    if (this.mode === 'drop') {
      const dropped = new Set(indices);
      data.cols = data.cols.filter((_, i) => !dropped.has(i));
      data.rows = rows.map(row => {
        if (!Array.isArray(row)) return row;
        cells += indices.filter(i => i < row.length).length;
        return row.filter((_, i) => !dropped.has(i));
      });
      if (data.results_metadata?.columns) {
        data.results_metadata.columns = data.results_metadata.columns.filter(c => !this.matches(c.name));
      }
    } else {
      for (const row of rows) {
        if (!Array.isArray(row)) continue;
        for (const i of indices) {
          if (i < row.length) {
            row[i] = REDACTED_VALUE;
            cells++;
          }
        }
      }
    }

    // Insights (timeseries last/previous value, slope) carry column values
    if (Array.isArray(data.insights)) {
      data.insights = data.insights.filter(insight => !this.matches(insight?.col));
    }
    this.scrubMetadata(data.cols);
    this.scrubMetadata(data.results_metadata);

    this.onRedact?.({ columns, cells, mode: this.mode });
    return result;
  }

  /**
   * Remove `fingerprint` (min/max/avg and similar value statistics) from any
   * nested column-like object whose name matches, and filter dashboard
   * `param_values` (distinct values behind filters) for redacted fields.
   * Mutates and returns value. Used for card and dashboard payloads.
   */
  scrubMetadata<T>(value: T): T {
    if (!this.enabled) return value;
    const visit = (node: unknown): void => {
      if (Array.isArray(node)) {
        node.forEach(visit);
      } else if (node && typeof node === 'object') {
        const obj = node as Record<string, unknown>;
        if ('fingerprint' in obj && this.matches(obj.name)) delete obj.fingerprint;
        if (obj.param_values && typeof obj.param_values === 'object') this.scrubParamValues(obj);
        Object.values(obj).forEach(visit);
      }
    };
    visit(value);
    return value;
  }

  /**
   * `param_values` is keyed by field id with no column name; names come from
   * the sibling `param_fields`. Values whose field can't be resolved are
   * dropped (fail closed) — they only populate filter pickers.
   */
  private scrubParamValues(obj: Record<string, unknown>): void {
    const paramValues = obj.param_values as Record<string, unknown>;
    const paramFields = (obj.param_fields ?? {}) as Record<string, unknown>;
    for (const fieldId of Object.keys(paramValues)) {
      const entry = paramFields[fieldId];
      const fields = (Array.isArray(entry) ? entry : [entry]) as Array<{ name?: unknown } | null | undefined>;
      const names = fields.map(f => f?.name).filter(n => typeof n === 'string');
      if (names.length === 0 || names.some(n => this.matches(n))) delete paramValues[fieldId];
    }
  }
}
