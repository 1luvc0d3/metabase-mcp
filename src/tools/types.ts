/**
 * Tool Context Types
 * Shared context passed to all tool handlers
 */

import type { ServerMode } from '../client/types.js';
import type { MetabaseClient } from '../client/metabase-client.js';
import type { LLMService } from '../client/llm-service.js';
import type { SQLGuardrails } from '../security/sql-guardrails.js';
import type { TieredRateLimiter } from '../security/rate-limiter.js';
import type { AuditLogger } from '../security/audit-logger.js';
import type { SchemaManager } from '../utils/schema-manager.js';
import type { Logger } from '../config.js';

/**
 * Subset of config exposed to tool handlers.
 * Intentionally excludes API keys and other secrets.
 */
export interface ToolConfig {
  mode: ServerMode;
  metabase: {
    maxRows: number;
  };
}

export interface ToolContext {
  config: ToolConfig;
  metabaseClient: MetabaseClient;
  llmService: LLMService | null;
  sqlGuardrails: SQLGuardrails;
  rateLimiter: TieredRateLimiter;
  auditLogger: AuditLogger;
  schemaManager: SchemaManager;
  logger: Logger;
}

export type ToolHandler<T = unknown> = (
  args: T,
  context: ToolContext
) => Promise<ToolResponse>;

export interface ToolResponse {
  [x: string]: unknown;
  content: Array<{
    type: 'text';
    text: string;
  }>;
  isError?: boolean;
}

export function createTextResponse(data: unknown): ToolResponse {
  return {
    content: [{
      type: 'text' as const,
      text: typeof data === 'string' ? data : JSON.stringify(data, null, 2),
    }],
  };
}

export function createCompactTextResponse(data: unknown): ToolResponse {
  return {
    content: [{
      type: 'text' as const,
      text: typeof data === 'string' ? data : JSON.stringify(data),
    }],
  };
}

export function createErrorResponse(error: Error | string): ToolResponse {
  const message = error instanceof Error ? error.message : error;
  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({ error: message }, null, 2),
    }],
    isError: true,
  };
}
