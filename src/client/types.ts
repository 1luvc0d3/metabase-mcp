/**
 * Metabase API Types
 * Based on Metabase REST API v0.46+
 */

// ============================================================================
// Database Types
// ============================================================================

export interface Database {
  id: number;
  name: string;
  description: string | null;
  engine: string;
  features: string[];
  is_sample: boolean;
  is_saved_questions: boolean;
  created_at: string;
  updated_at: string;
}

export interface DatabaseMetadata {
  id: number;
  name: string;
  tables: TableMetadata[];
}

export interface TableMetadata {
  id: number;
  name: string;
  display_name: string;
  description: string | null;
  schema: string | null;
  fields: FieldMetadata[];
}

export interface FieldMetadata {
  id: number;
  name: string;
  display_name: string;
  description: string | null;
  base_type: string;
  semantic_type: string | null;
  fk_target_field_id: number | null;
}

// ============================================================================
// Dashboard Types
// ============================================================================

export interface Dashboard {
  id: number;
  name: string;
  description: string | null;
  collection_id: number | null;
  creator_id: number;
  created_at: string;
  updated_at: string;
  archived: boolean;
  dashcards?: DashboardCard[];
}

export interface DashboardCard {
  id: number;
  card_id: number | null;
  dashboard_id: number;
  size_x: number;
  size_y: number;
  row: number;
  col: number;
  card?: Card;
}

export interface CreateDashboardRequest {
  name: string;
  description?: string;
  collection_id?: number;
}

// ============================================================================
// Card (Question) Types
// ============================================================================

export interface Card {
  id: number;
  name: string;
  description: string | null;
  display: string;
  collection_id: number | null;
  creator_id: number;
  database_id: number;
  dataset_query: DatasetQuery;
  visualization_settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  archived: boolean;
}

export interface DatasetQuery {
  type: 'native' | 'query';
  database: number;
  native?: {
    query: string;
    template_tags?: Record<string, unknown>;
  };
  query?: {
    source_table?: number;
    aggregation?: unknown[];
    breakout?: unknown[];
    filter?: unknown[];
  };
}

export interface CreateCardRequest {
  name: string;
  dataset_query: DatasetQuery;
  display: string;
  visualization_settings: Record<string, unknown>;
  collection_id?: number;
  description?: string;
}

// ============================================================================
// Query Result Types
// ============================================================================

export interface QueryResult {
  data: {
    rows: unknown[][];
    cols: ColumnInfo[];
    native_form?: {
      query: string;
    };
    results_metadata?: {
      columns: ColumnMetadata[];
    };
  };
  database_id: number;
  started_at: string;
  json_query: DatasetQuery;
  average_execution_time: number | null;
  status: 'completed' | 'failed';
  context: string;
  row_count: number;
  running_time: number;
}

export interface ColumnInfo {
  name: string;
  display_name: string;
  base_type: string;
  semantic_type: string | null;
  field_ref?: unknown[];
}

export interface ColumnMetadata {
  name: string;
  display_name: string;
  base_type: string;
}

// ============================================================================
// Collection Types
// ============================================================================

export interface Collection {
  id: number | 'root';
  name: string;
  description: string | null;
  color: string;
  archived: boolean;
  location: string;
  personal_owner_id: number | null;
}

// ============================================================================
// Search Types
// ============================================================================

export interface SearchResult {
  id: number;
  name: string;
  description: string | null;
  model: 'card' | 'dashboard' | 'collection' | 'database' | 'table';
  collection_id: number | null;
  collection_name: string | null;
}

// ============================================================================
// Schema Types (for NLQ)
// ============================================================================

export interface DatabaseSchema {
  tables: SchemaTable[];
}

export interface SchemaTable {
  name: string;
  description?: string | null;
  columns: SchemaColumn[];
}

export interface SchemaColumn {
  name: string;
  type: string;
  description?: string | null;
}

// ============================================================================
// NLQ Types
// ============================================================================

export interface SQLGenerationResult {
  sql: string;
  explanation?: string;
  confidence?: number;
}

export interface SQLExample {
  question: string;
  sql: string;
}

export interface InsightsResult {
  summary: string;
  points: string[];
  recommendations?: string[];
}

// ============================================================================
// Tool Context Types
// ============================================================================

export type ServerMode = 'read' | 'write' | 'full';

export interface MetabaseConfig {
  url: string;
  apiKey?: string;
  timeout: number;
  maxRows: number;
}

export interface SecurityConfig {
  allowedSqlPatterns: string[];
  blockedPatterns: string[];
  rateLimit: {
    requestsPerMinute: number;
  };
}

export interface LLMConfig {
  model: string;
  fallbackModel?: string;
  dailyTokenLimit: number;
  monthlyTokenLimit: number;
  retryAttempts: number;
  retryDelayMs: number;
  timeoutMs: number;
}

export interface AppConfig {
  mode: ServerMode;
  metabase: MetabaseConfig;
  anthropicApiKey?: string;
  llm: LLMConfig;
  security: SecurityConfig;
  logging: {
    level: 'debug' | 'info' | 'warn' | 'error';
    auditFile?: string;
  };
}
