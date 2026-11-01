/**
 * MetabaseClient Unit Tests
 * Dashboard-card operations: legacy endpoint with modern (v0.50+) fallback
 * Column redaction applied at the client chokepoint
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MetabaseClient } from '../../../src/client/metabase-client.js';
import { ColumnRedactor, REDACTED_VALUE } from '../../../src/security/column-redactor.js';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as unknown as Response;
}

describe('MetabaseClient dashboard-card operations', () => {
  let client: MetabaseClient;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    client = new MetabaseClient({
      url: 'https://mb.test',
      apiKey: 'key',
      timeout: 30000,
      maxRows: 1000,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('addCardToDashboard', () => {
    it('uses the legacy POST endpoint when it exists (Metabase < v0.50)', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({}));

      await client.addCardToDashboard(7, 42, { row: 1, col: 2 });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://mb.test/api/dashboard/7/cards');
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body)).toMatchObject({ cardId: 42, row: 1, col: 2 });
    });

    it('falls back to PUT /dashboard/:id with dashcards on 404 (Metabase >= v0.50)', async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse({ message: 'not found' }, 404))
        .mockResolvedValueOnce(jsonResponse({ id: 7, dashcards: [{ id: 5, card_id: 9 }] }))
        .mockResolvedValueOnce(jsonResponse({}));

      await client.addCardToDashboard(7, 42, { size_x: 12, size_y: 8 });

      expect(fetchMock).toHaveBeenCalledTimes(3);
      const [putUrl, putInit] = fetchMock.mock.calls[2];
      expect(putUrl).toBe('https://mb.test/api/dashboard/7');
      expect(putInit.method).toBe('PUT');
      const body = JSON.parse(putInit.body);
      expect(body.dashcards).toHaveLength(2);
      expect(body.dashcards[0]).toMatchObject({ id: 5, card_id: 9 });
      expect(body.dashcards[1]).toMatchObject({ id: -1, card_id: 42, size_x: 12, size_y: 8 });
    });

    it('does not fall back on non-404 errors', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ message: 'forbidden' }, 403));

      await expect(client.addCardToDashboard(7, 42)).rejects.toThrow('403');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('removeCardFromDashboard', () => {
    it('uses the legacy DELETE endpoint when it exists (Metabase < v0.50)', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({}));

      await client.removeCardFromDashboard(7, 5);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://mb.test/api/dashboard/7/cards');
      expect(init.method).toBe('DELETE');
    });

    it('falls back to PUT without the removed dashcard on 404 (Metabase >= v0.50)', async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse({ message: 'not found' }, 404))
        .mockResolvedValueOnce(jsonResponse({ id: 7, dashcards: [{ id: 5 }, { id: 6 }] }))
        .mockResolvedValueOnce(jsonResponse({}));

      await client.removeCardFromDashboard(7, 5);

      const [putUrl, putInit] = fetchMock.mock.calls[2];
      expect(putUrl).toBe('https://mb.test/api/dashboard/7');
      expect(putInit.method).toBe('PUT');
      expect(JSON.parse(putInit.body).dashcards).toEqual([{ id: 6 }]);
    });
  });
});

describe('MetabaseClient column redaction', () => {
  const config = { url: 'https://mb.test', apiKey: 'key', timeout: 30000, maxRows: 1000 };
  const queryResponse = () => ({
    data: {
      cols: [{ name: 'id' }, { name: 'email', fingerprint: { x: 1 } }],
      rows: [[1, 'a@example.com']],
    },
    row_count: 1,
  });
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('redacts native query results', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(queryResponse()));
    const client = new MetabaseClient(config, new ColumnRedactor({ columns: ['email'] }));

    const result = await client.executeQuery(1, 'SELECT * FROM users');

    expect(result.data.rows).toEqual([[1, REDACTED_VALUE]]);
  });

  it('redacts saved card results, including through executeQueryWithLimit', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(queryResponse()))
      .mockResolvedValueOnce(jsonResponse(queryResponse()));
    const client = new MetabaseClient(config, new ColumnRedactor({ columns: ['email'], mode: 'drop' }));

    const card = await client.executeCard(9);
    const limited = await client.executeQueryWithLimit(1, 'SELECT * FROM users', 10);

    expect(card.data.rows).toEqual([[1]]);
    expect(limited.data.rows).toEqual([[1]]);
  });

  it('scrubs fingerprints of redacted columns from card metadata', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      id: 9,
      result_metadata: [{ name: 'email', fingerprint: { x: 1 } }, { name: 'id', fingerprint: { y: 1 } }],
    }));
    const client = new MetabaseClient(config, new ColumnRedactor({ columns: ['email'] }));

    const card = await client.getCard(9) as unknown as { result_metadata: Array<Record<string, unknown>> };

    expect(card.result_metadata[0]).toEqual({ name: 'email' });
    expect(card.result_metadata[1].fingerprint).toEqual({ y: 1 });
  });

  it('scrubs filter values of redacted fields from dashboards', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      id: 7,
      param_fields: { '10': { id: 10, name: 'email' } },
      param_values: { '10': { field_id: 10, values: [['a@example.com']] } },
    }));
    const client = new MetabaseClient(config, new ColumnRedactor({ columns: ['email'] }));

    const dashboard = await client.getDashboard(7) as unknown as { param_values: Record<string, unknown> };

    expect(dashboard.param_values).toEqual({});
  });

  it('passes results through unchanged without a redactor', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(queryResponse()));
    const client = new MetabaseClient(config);

    const result = await client.executeQuery(1, 'SELECT * FROM users');

    expect(result.data.rows).toEqual([[1, 'a@example.com']]);
  });
});
