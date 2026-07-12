/**
 * MetabaseClient Unit Tests
 * Dashboard-card operations: legacy endpoint with modern (v0.50+) fallback
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MetabaseClient } from '../../../src/client/metabase-client.js';

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
