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

describe('MetabaseClient authentication headers', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(jsonResponse([]));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const headersSent = async (auth: { apiKey?: string; sessionToken?: string }) => {
    const client = new MetabaseClient({ url: 'https://mb.test', timeout: 30000, maxRows: 1000, ...auth });
    await client.getDatabases();
    return fetchMock.mock.calls[0][1].headers as Record<string, string>;
  };

  it('sends X-API-Key when an API key is configured', async () => {
    const headers = await headersSent({ apiKey: 'key' });

    expect(headers['X-API-Key']).toBe('key');
    expect(headers['X-Metabase-Session']).toBeUndefined();
  });

  it('sends X-Metabase-Session when only a session token is configured', async () => {
    const headers = await headersSent({ sessionToken: 'sess-123' });

    expect(headers['X-Metabase-Session']).toBe('sess-123');
    expect(headers['X-API-Key']).toBeUndefined();
  });

  it('prefers the API key when both are configured', async () => {
    const headers = await headersSent({ apiKey: 'key', sessionToken: 'sess-123' });

    expect(headers['X-API-Key']).toBe('key');
    expect(headers['X-Metabase-Session']).toBeUndefined();
  });
});

describe('MetabaseClient empty responses', () => {
  // Metabase answers DELETE with 204 No Content. response.json() throws on an empty body,
  // which made delete_card/delete_dashboard report an error after a successful delete.
  const noContent = (): Response =>
    ({
      ok: true,
      status: 204,
      text: async () => '',
      json: async () => {
        throw new SyntaxError('Unexpected end of JSON input');
      },
    }) as unknown as Response;

  let fetchMock: ReturnType<typeof vi.fn>;
  let client: MetabaseClient;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(noContent());
    vi.stubGlobal('fetch', fetchMock);
    client = new MetabaseClient({ url: 'https://mb.test', apiKey: 'key', timeout: 30000, maxRows: 1000 });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('deleteCard resolves on 204 No Content', async () => {
    await expect(client.deleteCard(7)).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[0][0]).toBe('https://mb.test/api/card/7');
    expect(fetchMock.mock.calls[0][1].method).toBe('DELETE');
  });

  it('deleteDashboard resolves on 204 No Content', async () => {
    await expect(client.deleteDashboard(3)).resolves.toBeUndefined();
  });

  it('treats a 200 with an empty body as no content', async () => {
    fetchMock.mockResolvedValueOnce({ ...noContent(), status: 200 });
    await expect(client.deleteCard(7)).resolves.toBeUndefined();
  });
});

describe('MetabaseClient.executeCard parameters', () => {
  // /api/card/:id/query takes parameters as [{ id, type, target, value }] where id is the
  // template tag's id; a { name: value } object is rejected with a 400. The tool accepts
  // { name: value } and the client maps it onto the card's template tags.
  let fetchMock: ReturnType<typeof vi.fn>;
  let client: MetabaseClient;
  const queryResult = { data: { rows: [[1]], cols: [{ name: 'n' }] }, row_count: 1, status: 'completed' };

  // Metabase >= v0.6x stores queries as stages with a template-tags list.
  const stagesCard = {
    id: 46,
    dataset_query: {
      'lib/type': 'mbql/query',
      database: 1,
      stages: [{
        'template-tags': [
          { id: 'id-n', name: 'n', 'display-name': 'N', type: 'number' },
          { id: 'id-t', name: 't', 'display-name': 'Title', type: 'text' },
          { id: 'id-d', name: 'created', 'display-name': 'Created', type: 'date' },
          { id: 'id-f', name: 'state', 'display-name': 'State', type: 'dimension', 'widget-type': 'string/=' },
        ],
      }],
    },
  };
  // Older versions keep a native query with a template-tags map.
  const legacyCard = {
    id: 9,
    dataset_query: {
      type: 'native',
      database: 1,
      native: { query: 'SELECT {{n}}', 'template-tags': { n: { id: 'id-n', name: 'n', 'display-name': 'N', type: 'number' } } },
    },
  };

  const sentBody = (callIndex: number) => JSON.parse(fetchMock.mock.calls[callIndex][1].body);

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    client = new MetabaseClient({ url: 'https://mb.test', apiKey: 'key', timeout: 30000, maxRows: 1000 });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('maps { name: value } onto template tags for stage-based queries', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(stagesCard)).mockResolvedValueOnce(jsonResponse(queryResult));

    await client.executeCard(46, { n: 5, t: 'hi', created: '2026-01-01', state: 'CA' });

    expect(fetchMock.mock.calls[0][0]).toBe('https://mb.test/api/card/46');
    expect(fetchMock.mock.calls[1][0]).toBe('https://mb.test/api/card/46/query');
    expect(sentBody(1).parameters).toEqual([
      { id: 'id-n', type: 'number/=', target: ['variable', ['template-tag', 'n']], value: 5 },
      { id: 'id-t', type: 'category', target: ['variable', ['template-tag', 't']], value: 'hi' },
      { id: 'id-d', type: 'date/single', target: ['variable', ['template-tag', 'created']], value: '2026-01-01' },
      { id: 'id-f', type: 'string/=', target: ['dimension', ['template-tag', 'state']], value: 'CA' },
    ]);
  });

  it('maps parameters for legacy native queries with a template-tags map', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(legacyCard)).mockResolvedValueOnce(jsonResponse(queryResult));

    await client.executeCard(9, { n: 3 });

    expect(sentBody(1).parameters).toEqual([
      { id: 'id-n', type: 'number/=', target: ['variable', ['template-tag', 'n']], value: 3 },
    ]);
  });

  it('matches parameter names case-insensitively and by display name', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(stagesCard)).mockResolvedValueOnce(jsonResponse(queryResult));

    await client.executeCard(46, { N: 1, title: 'x' });

    expect(sentBody(1).parameters.map((p: { id: string }) => p.id)).toEqual(['id-n', 'id-t']);
  });

  it('rejects an unknown parameter with the valid names and does not run the query', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(stagesCard));

    await expect(client.executeCard(46, { nope: 1 })).rejects.toMatchObject({
      code: 'UNKNOWN_PARAMETER',
      // Tool responses carry only the message, so it must name the valid parameters.
      message: 'Card 46 has no parameter "nope". Valid parameters: n, t, created, state',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sends no parameters and skips the card lookup when none are given', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(queryResult)).mockResolvedValueOnce(jsonResponse(queryResult));

    await client.executeCard(46);
    await client.executeCard(46, {});

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sentBody(0)).toEqual({});
    expect(sentBody(1)).toEqual({});
  });
});
