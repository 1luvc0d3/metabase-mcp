/**
 * ColumnRedactor Unit Tests
 */

import { describe, it, expect, vi } from 'vitest';
import { ColumnRedactor, REDACTED_VALUE } from '../../../src/security/column-redactor.js';
import type { QueryResult } from '../../../src/client/types.js';

function makeResult(): QueryResult {
  return {
    data: {
      cols: [
        { name: 'id', display_name: 'ID', base_type: 'type/Integer', semantic_type: null },
        { name: 'Email', display_name: 'Email', base_type: 'type/Text', semantic_type: 'type/Email',
          fingerprint: { type: { 'type/Text': { 'percent-email': 1 } } } },
        { name: 'salary', display_name: 'Salary', base_type: 'type/Float', semantic_type: null,
          fingerprint: { type: { 'type/Number': { min: 40000, max: 250000 } } } },
      ],
      rows: [
        [1, 'a@example.com', 50000],
        [2, 'b@example.com', 90000],
      ],
      results_metadata: {
        columns: [
          { name: 'id', display_name: 'ID', base_type: 'type/Integer' },
          { name: 'Email', display_name: 'Email', base_type: 'type/Text', fingerprint: { x: 1 } },
          { name: 'salary', display_name: 'Salary', base_type: 'type/Float', fingerprint: { min: 40000 } },
        ],
      },
      insights: [{ col: 'salary', 'last-value': 90000 }, { col: 'id', 'last-value': 2 }],
    },
    database_id: 1,
    started_at: '2026-10-31T00:00:00Z',
    json_query: {} as QueryResult['json_query'],
    row_count: 2,
    status: 'completed',
  } as QueryResult;
}

describe('ColumnRedactor', () => {
  it('is disabled with no patterns and leaves results untouched', () => {
    const redactor = new ColumnRedactor({ columns: [] });
    const result = makeResult();
    redactor.redactQueryResult(result);

    expect(redactor.enabled).toBe(false);
    expect(result).toEqual(makeResult());
  });

  it('matches case-insensitively with * globs', () => {
    const redactor = new ColumnRedactor({ columns: ['email', '*_ssn', 'card.*'] });

    expect(redactor.matches('EMAIL')).toBe(true);
    expect(redactor.matches('customer_ssn')).toBe(true);
    expect(redactor.matches('card.number')).toBe(true);
    expect(redactor.matches('email_verified')).toBe(false);
    expect(redactor.matches('cardXnumber')).toBe(false); // '.' is literal
    expect(redactor.matches(undefined)).toBe(false);
  });

  it('masks matching cells but keeps column shape in mask mode', () => {
    const redactor = new ColumnRedactor({ columns: ['email', 'salary'] });
    const result = redactor.redactQueryResult(makeResult());

    expect(result.data.cols.map(c => c.name)).toEqual(['id', 'Email', 'salary']);
    expect(result.data.rows).toEqual([
      [1, REDACTED_VALUE, REDACTED_VALUE],
      [2, REDACTED_VALUE, REDACTED_VALUE],
    ]);
  });

  it('removes matching columns from cols, rows and results_metadata in drop mode', () => {
    const redactor = new ColumnRedactor({ columns: ['email'], mode: 'drop' });
    const result = redactor.redactQueryResult(makeResult());

    expect(result.data.cols.map(c => c.name)).toEqual(['id', 'salary']);
    expect(result.data.rows).toEqual([[1, 50000], [2, 90000]]);
    expect(result.data.results_metadata?.columns.map(c => c.name)).toEqual(['id', 'salary']);
  });

  it('strips fingerprints and insights of redacted columns only', () => {
    const redactor = new ColumnRedactor({ columns: ['salary'] });
    const result = redactor.redactQueryResult(makeResult());

    expect(result.data.cols[2].fingerprint).toBeUndefined();
    expect(result.data.cols[1].fingerprint).toBeDefined();
    expect(result.data.results_metadata?.columns[2].fingerprint).toBeUndefined();
    expect(result.data.results_metadata?.columns[1].fingerprint).toBeDefined();
    expect(result.data.insights).toEqual([{ col: 'id', 'last-value': 2 }]);
  });

  it('reports redacted columns and cell count', () => {
    const onRedact = vi.fn();
    const redactor = new ColumnRedactor({ columns: ['email', 'salary'], onRedact });
    redactor.redactQueryResult(makeResult());

    expect(onRedact).toHaveBeenCalledWith({ columns: ['Email', 'salary'], cells: 4, mode: 'mask' });
  });

  it('does not report when no column matched', () => {
    const onRedact = vi.fn();
    const redactor = new ColumnRedactor({ columns: ['password'], onRedact });
    const result = redactor.redactQueryResult(makeResult());

    expect(onRedact).not.toHaveBeenCalled();
    expect(result.data.rows[0]).toEqual([1, 'a@example.com', 50000]);
  });

  it('tolerates short rows, null rows and missing data in both modes', () => {
    for (const mode of ['mask', 'drop'] as const) {
      const onRedact = vi.fn();
      const redactor = new ColumnRedactor({ columns: ['salary'], mode, onRedact });
      const result = makeResult();
      (result.data.rows as unknown[]) = [[1, 'a@example.com'], null, [2, 'b@example.com', 90000]];

      redactor.redactQueryResult(result);

      expect(result.data.rows[0]).toEqual([1, 'a@example.com']);
      expect(result.data.rows[1]).toBeNull();
      expect(result.data.rows[2]).toEqual(mode === 'mask' ? [2, 'b@example.com', REDACTED_VALUE] : [2, 'b@example.com']);
      expect(onRedact).toHaveBeenCalledWith(expect.objectContaining({ cells: 1 }));
    }

    const redactor = new ColumnRedactor({ columns: ['salary'] });
    expect(() => redactor.redactQueryResult({} as QueryResult)).not.toThrow();
    expect(() => redactor.redactQueryResult({ data: { cols: [{ name: 'salary' }] } } as unknown as QueryResult)).not.toThrow();
  });

  it('filters insights and works without results_metadata in drop mode', () => {
    const redactor = new ColumnRedactor({ columns: ['salary'], mode: 'drop' });
    const result = makeResult();
    delete result.data.results_metadata;

    redactor.redactQueryResult(result);

    expect(result.data.cols.map(c => c.name)).toEqual(['id', 'Email']);
    expect(result.data.insights).toEqual([{ col: 'id', 'last-value': 2 }]);
  });

  it('drops dashboard param_values for redacted or unresolvable fields', () => {
    const redactor = new ColumnRedactor({ columns: ['email'] });
    const dashboard = {
      param_fields: {
        '10': { id: 10, name: 'EMAIL' },
        '11': [{ id: 11, name: 'state' }],
      },
      param_values: {
        '10': { field_id: 10, values: [['a@example.com']] },
        '11': { field_id: 11, values: [['CA'], ['NY']] },
        '12': { field_id: 12, values: [['unknown']] },
      },
    };

    redactor.scrubMetadata(dashboard);

    expect(Object.keys(dashboard.param_values)).toEqual(['11']);
  });

  it('resolves param_values fields when param_fields is keyed by parameter id (v0.6x)', () => {
    const redactor = new ColumnRedactor({ columns: ['source'] });
    const dashboard = {
      param_fields: {
        p_source: [{ id: 30, name: 'SOURCE' }],
        p_state: [{ id: 1, name: 'STATE' }],
      },
      param_values: {
        '30': { field_id: 30, values: [['Google']] },
        '1': { field_id: 1, values: [['CA']] },
      },
    };

    redactor.scrubMetadata(dashboard);

    expect(Object.keys(dashboard.param_values)).toEqual(['1']);
  });

  it('scrubs fingerprints from nested card and dashboard metadata', () => {
    const redactor = new ColumnRedactor({ columns: ['salary'] });
    const dashboard = {
      id: 1,
      dashcards: [{
        card: {
          result_metadata: [
            { name: 'salary', fingerprint: { min: 1 } },
            { name: 'id', fingerprint: { min: 1 } },
          ],
        },
      }],
    };

    redactor.scrubMetadata(dashboard);

    const meta = dashboard.dashcards[0].card.result_metadata;
    expect(meta[0]).toEqual({ name: 'salary' });
    expect(meta[1].fingerprint).toEqual({ min: 1 });
  });
});
