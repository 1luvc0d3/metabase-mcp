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
import { MetabaseError, wrapError } from '../utils/errors.js';

export class MetabaseClient {
  private baseUrl: string;
  private timeout: number;
  private maxRows: number;
  private apiKey?: string;

  constructor(config: MetabaseConfig) {
    this.baseUrl = config.url.replace(/\/$/, ''); // Remove trailing slash
    this.timeout = config.timeout;
    this.maxRows = config.maxRows;
    this.apiKey = config.apiKey;
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

      return response.json() as Promise<T>;
    } catch (error) {
      if (error instanceof MetabaseError) {
        throw error;
      }
      throw wrapError(error, 'Metabase API request failed');
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.apiKey) {
      headers['X-API-Key'] = this.apiKey;
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
    return this.request<Dashboard>(`/dashboard/${id}`);
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
   * Delete (archive) a dashboard
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
    return this.request<Card[]>('/card');
  }

  /**
   * Get card by ID
   */
  async getCard(id: number): Promise<Card> {
    return this.request<Card>(`/card/${id}`);
  }

  /**
   * Execute a card (run the query)
   */
  async executeCard(id: number, parameters?: Record<string, unknown>): Promise<QueryResult> {
    const body = parameters ? { parameters } : {};
    return this.request<QueryResult>(`/card/${id}/query`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  /**
   * Create a new card
   */
  async createCard(card: CreateCardRequest): Promise<Card> {
    return this.request<Card>('/card', {
      method: 'POST',
      body: JSON.stringify(card),
    });
  }

  /**
   * Update an existing card
   */
  async updateCard(id: number, updates: Partial<Card>): Promise<Card> {
    return this.request<Card>(`/card/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
  }

  /**
   * Delete (archive) a card
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
    return this.request<QueryResult>('/dataset', {
      method: 'POST',
      body: JSON.stringify({
        database: databaseId,
        type: 'native',
        native: { query: sql },
      }),
    });
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
    await this.request(`/dashboard/${dashboardId}/cards`, {
      method: 'POST',
      body: JSON.stringify({
        cardId,
        row: options?.row ?? 0,
        col: options?.col ?? 0,
        size_x: options?.size_x ?? 4,
        size_y: options?.size_y ?? 4,
      }),
    });
  }

  /**
   * Remove a card from a dashboard
   */
  async removeCardFromDashboard(dashboardId: number, dashcardId: number): Promise<void> {
    await this.request(`/dashboard/${dashboardId}/cards`, {
      method: 'DELETE',
      body: JSON.stringify({ dashcardId }),
    });
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
