/**
 * Metabase API Client
 * Wrapper for Metabase REST API with timeout and error handling
 */

import type {
  MetabaseConfig,
  Database,
  DatabaseMetadata,
  Dashboard,
  Card,
  QueryResult,
  Collection,
  SearchResult,
  CreateCardRequest,
  CreateDashboardRequest,
} from './types.js';
import { MetabaseError, UserFriendlyError, wrapError } from '../utils/errors.js';
import type { ColumnRedactor } from '../security/column-redactor.js';

interface TemplateTag {
  id?: string;
  name: string;
  'display-name'?: string;
  type?: string;
  'widget-type'?: string;
}

/**
 * Template tags of a native card. Metabase >= v0.6x stores queries as stages with a
 * template-tags list; older versions keep a native query with a template-tags map.
 */
function templateTags(card: Card): TemplateTag[] {
  const query = card.dataset_query as unknown as {
    native?: { 'template-tags'?: Record<string, TemplateTag> };
    stages?: Array<{ 'template-tags'?: TemplateTag[] | Record<string, TemplateTag> }>;
  };
  const tags = query?.native?.['template-tags'] ?? query?.stages?.[0]?.['template-tags'];
  if (!tags) return [];
  return Array.isArray(tags) ? tags : Object.values(tags);
}

/** Parameter type Metabase expects for a template tag's value. */
function parameterType(tag: TemplateTag): string {
  switch (tag.type) {
    case 'number':
      return 'number/=';
    case 'date':
      return 'date/single';
    case 'dimension':
      return tag['widget-type'] ?? 'category';
    default:
      return 'category';
  }
}

export class MetabaseClient {
  private baseUrl: string;
  private timeout: number;
  private maxRows: number;
  private apiKey?: string;
  private sessionToken?: string;
  private redactor?: ColumnRedactor;

  constructor(config: MetabaseConfig, redactor?: ColumnRedactor) {
    this.baseUrl = config.url.replace(/\/$/, ''); // Remove trailing slash
    this.timeout = config.timeout;
    this.maxRows = config.maxRows;
    this.apiKey = config.apiKey;
    this.sessionToken = config.sessionToken;
    this.redactor = redactor?.enabled ? redactor : undefined;
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  private async request<T>(
    endpoint: string,
    options?: RequestInit,
  ): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const url = `${this.baseUrl}/api${endpoint}`;
      const headers = this.buildHeaders();

      const response = await fetch(url, {
        ...options,
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          ...headers,
          ...options?.headers,
        },
      });

      // Reject redirects to prevent leaking API key to redirect targets
      if (response.status >= 300 && response.status < 400) {
        throw new MetabaseError(response.status, 'Redirect not allowed');
      }

      if (!response.ok) {
        const body = await response.text();
        throw new MetabaseError(response.status, body);
      }

      // DELETE answers 204 No Content; parsing an empty body as JSON would throw after the
      // operation had already succeeded.
      if (response.status === 204) {
        return undefined as T;
      }
      const text = await response.text();
      return (text ? JSON.parse(text) : undefined) as T;
    } catch (error) {
      if (error instanceof MetabaseError) {
        throw error;
      }
      throw wrapError(error, 'Metabase API request failed');
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private redact(result: QueryResult): QueryResult {
    return this.redactor ? this.redactor.redactQueryResult(result) : result;
  }

  /** Strip value fingerprints of redacted columns from card/dashboard metadata */
  private scrub<T>(value: T): T {
    return this.redactor ? this.redactor.scrubMetadata(value) : value;
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.apiKey) {
      headers['X-API-Key'] = this.apiKey;
    } else if (this.sessionToken) {
      headers['X-Metabase-Session'] = this.sessionToken;
    }

    return headers;
  }

  // ============================================================================
  // Database Operations
  // ============================================================================

  /**
   * List all databases
   */
  async getDatabases(): Promise<Database[]> {
    const response = await this.request<{ data: Database[] }>('/database');
    return response.data;
  }

  /**
   * Get database by ID
   */
  async getDatabase(id: number): Promise<Database> {
    return this.request<Database>(`/database/${id}`);
  }

  /**
   * Get database schema (tables and columns)
   */
  async getDatabaseSchema(id: number): Promise<DatabaseMetadata> {
    return this.request<DatabaseMetadata>(`/database/${id}/metadata`);
  }

  // ============================================================================
  // Dashboard Operations
  // ============================================================================

  /**
   * List all dashboards
   */
  async getDashboards(): Promise<Dashboard[]> {
    return this.request<Dashboard[]>('/dashboard');
  }

  /**
   * Get dashboard by ID (includes cards)
   */
  async getDashboard(id: number): Promise<Dashboard> {
    return this.scrub(await this.request<Dashboard>(`/dashboard/${id}`));
  }

  /**
   * Create a new dashboard
   */
  async createDashboard(dashboard: CreateDashboardRequest): Promise<Dashboard> {
    return this.request<Dashboard>('/dashboard', {
      method: 'POST',
      body: JSON.stringify(dashboard),
    });
  }

  /**
   * Update an existing dashboard
   */
  async updateDashboard(id: number, updates: Partial<Dashboard>): Promise<Dashboard> {
    return this.request<Dashboard>(`/dashboard/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
  }

  /**
   * Permanently delete a dashboard (DELETE /api/dashboard/:id; not recoverable from trash)
   */
  async deleteDashboard(id: number): Promise<void> {
    await this.request(`/dashboard/${id}`, { method: 'DELETE' });
  }

  // ============================================================================
  // Card (Question) Operations
  // ============================================================================

  /**
   * List all cards
   */
  async getCards(): Promise<Card[]> {
    return this.scrub(await this.request<Card[]>('/card'));
  }

  /**
   * Get card by ID
   */
  /**
   * /api/card/:id/query takes parameters as [{ id, type, target, value }], where id is the
   * template tag's id; a { name: value } object is rejected with a 400. Map the tool's
   * { name: value } input onto the card's template tags (matched by name or display name).
   */
  private async buildCardParameters(
    cardId: number,
    values: Record<string, unknown>,
  ): Promise<Array<Record<string, unknown>>> {
    const tags = templateTags(await this.request<Card>(`/card/${cardId}`));
    const byKey = new Map<string, TemplateTag>();
    for (const tag of tags) {
      if (tag['display-name']) byKey.set(tag['display-name'].toLowerCase(), tag);
      byKey.set(tag.name.toLowerCase(), tag);
    }

    return Object.entries(values).map(([key, value]) => {
      const tag = byKey.get(key.toLowerCase());
      if (!tag) {
        // Tool responses carry only the message, so the valid names go in the message itself.
        const suggestion = tags.length > 0
          ? `Valid parameters: ${tags.map((t) => t.name).join(', ')}`
          : 'This card takes no parameters; call it without parameters';
        throw new UserFriendlyError(
          `Card ${cardId} has no parameter "${key}". ${suggestion}`,
          suggestion,
          'UNKNOWN_PARAMETER',
        );
      }
      return {
        ...(tag.id ? { id: tag.id } : {}),
        type: parameterType(tag),
        target: [tag.type === 'dimension' ? 'dimension' : 'variable', ['template-tag', tag.name]],
        value,
      };
    });
  }

  async getCard(id: number): Promise<Card> {
    return this.scrub(await this.request<Card>(`/card/${id}`));
  }

  /**
   * Execute a card (run the query)
   */
  async executeCard(id: number, parameters?: Record<string, unknown>): Promise<QueryResult> {
    const body = parameters && Object.keys(parameters).length > 0
      ? { parameters: await this.buildCardParameters(id, parameters) }
      : {};
    return this.redact(await this.request<QueryResult>(`/card/${id}/query`, {
      method: 'POST',
      body: JSON.stringify(body),
    }));
  }

  /**
   * Create a new card
   */
  async createCard(card: CreateCardRequest): Promise<Card> {
    return this.scrub(await this.request<Card>('/card', {
      method: 'POST',
      body: JSON.stringify(card),
    }));
  }

  /**
   * Update an existing card
   */
  async updateCard(id: number, updates: Partial<Card>): Promise<Card> {
    return this.scrub(await this.request<Card>(`/card/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    }));
  }

  /**
   * Permanently delete a card (DELETE /api/card/:id; not recoverable from trash)
   */
  async deleteCard(id: number): Promise<void> {
    await this.request(`/card/${id}`, { method: 'DELETE' });
  }

  // ============================================================================
  // Query Operations
  // ============================================================================

  /**
   * Execute a native SQL query
   */
  async executeQuery(databaseId: number, sql: string): Promise<QueryResult> {
    return this.redact(await this.request<QueryResult>('/dataset', {
      method: 'POST',
      body: JSON.stringify({
        database: databaseId,
        type: 'native',
        native: { query: sql },
      }),
    }));
  }

  /**
   * Execute query and limit results
   */
  async executeQueryWithLimit(
    databaseId: number,
    sql: string,
    limit?: number
  ): Promise<QueryResult> {
    const result = await this.executeQuery(databaseId, sql);

    // Apply row limit
    const maxRows = limit ?? this.maxRows;
    if (result.data.rows.length > maxRows) {
      result.data.rows = result.data.rows.slice(0, maxRows);
      result.row_count = maxRows;
    }

    return result;
  }

  // ============================================================================
  // Collection Operations
  // ============================================================================

  /**
   * List all collections
   */
  async getCollections(): Promise<Collection[]> {
    return this.request<Collection[]>('/collection');
  }

  /**
   * Get collection by ID
   */
  async getCollection(id: number | 'root'): Promise<Collection> {
    return this.request<Collection>(`/collection/${id}`);
  }

  /**
   * Create a new collection
   */
  async createCollection(collection: { name: string; description?: string; color?: string; parent_id?: number }): Promise<Collection> {
    return this.request<Collection>('/collection', {
      method: 'POST',
      body: JSON.stringify(collection),
    });
  }

  // ============================================================================
  // Search Operations
  // ============================================================================

  /**
   * Search across Metabase content
   */
  async search(query: string, models?: string[]): Promise<SearchResult[]> {
    const params = new URLSearchParams({ q: query });
    if (models?.length) {
      models.forEach(m => params.append('models', m));
    }
    const response = await this.request<SearchResult[] | { data: SearchResult[] }>(`/search?${params.toString()}`);
    // Metabase may return { data: [...] } or a plain array depending on version/filters
    return Array.isArray(response) ? response : response.data;
  }

  // ============================================================================
  // Dashboard Card Operations
  // ============================================================================

  /**
   * Add a card to a dashboard
   */
  async addCardToDashboard(
    dashboardId: number,
    cardId: number,
    options?: { row?: number; col?: number; size_x?: number; size_y?: number }
  ): Promise<void> {
    const placement = {
      row: options?.row ?? 0,
      col: options?.col ?? 0,
      size_x: options?.size_x ?? 4,
      size_y: options?.size_y ?? 4,
    };

    try {
      // Metabase < v0.50 endpoint. Tried first because it fails loudly (404)
      // on modern versions, whereas the modern PUT silently ignores the
      // dashcards key on old versions.
      await this.request(`/dashboard/${dashboardId}/cards`, {
        method: 'POST',
        body: JSON.stringify({ cardId, ...placement }),
      });
    } catch (error) {
      if (!(error instanceof MetabaseError && (error.statusCode === 404 || error.statusCode === 405))) {
        throw error;
      }
      // Metabase >= v0.50: dashcards are edited via PUT /dashboard/:id with
      // the full dashcard set; id -1 marks a new card.
      const dashboard = await this.request<{ dashcards?: unknown[] }>(`/dashboard/${dashboardId}`);
      const dashcards = [
        ...(dashboard.dashcards ?? []),
        { id: -1, card_id: cardId, ...placement },
      ];
      await this.request(`/dashboard/${dashboardId}`, {
        method: 'PUT',
        body: JSON.stringify({ dashcards }),
      });
    }
  }

  /**
   * Remove a card from a dashboard
   */
  async removeCardFromDashboard(dashboardId: number, dashcardId: number): Promise<void> {
    try {
      // Metabase < v0.50 endpoint; fails loudly (404) on modern versions.
      await this.request(`/dashboard/${dashboardId}/cards`, {
        method: 'DELETE',
        body: JSON.stringify({ dashcardId }),
      });
    } catch (error) {
      if (!(error instanceof MetabaseError && (error.statusCode === 404 || error.statusCode === 405))) {
        throw error;
      }
      // Metabase >= v0.50: PUT the dashcard set back without the removed card.
      const dashboard = await this.request<{ dashcards?: Array<{ id: number }> }>(`/dashboard/${dashboardId}`);
      const dashcards = (dashboard.dashcards ?? []).filter(dc => dc.id !== dashcardId);
      await this.request(`/dashboard/${dashboardId}`, {
        method: 'PUT',
        body: JSON.stringify({ dashcards }),
      });
    }
  }

  // ============================================================================
  // Health Check
  // ============================================================================

  /**
   * Check if Metabase is reachable
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.request('/health');
      return true;
    } catch {
      return false;
    }
  }
}
