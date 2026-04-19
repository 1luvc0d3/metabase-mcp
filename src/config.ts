/**
 * Configuration Management
 * Loads and validates configuration from environment variables
 */

import { z } from 'zod';
import type { AppConfig, ServerMode } from './client/types.js';
import { ConfigurationError } from './utils/errors.js';

// ============================================================================
// Configuration Schema
// ============================================================================

const ServerModeSchema = z.enum(['read', 'write', 'full']).default('read');

const MetabaseConfigSchema = z.object({
  url: z.string().url('METABASE_URL must be a valid URL'),
  apiKey: z.string().optional(),
  timeout: z.number().min(1000).max(300000).default(30000),
  maxRows: z.number().min(1).max(100000).default(10000),
});

const SecurityConfigSchema = z.object({
  allowedSqlPatterns: z.array(z.string()).default(['SELECT', 'WITH']),
  blockedPatterns: z.array(z.string()).default([
    'DROP',
    'TRUNCATE',
    'DELETE',
    'UPDATE',
    'INSERT',
    'ALTER',
    'CREATE',
    'GRANT',
    'REVOKE',
    'EXEC',
    'EXECUTE',
  ]),
  rateLimit: z.object({
    requestsPerMinute: z.number().min(1).max(1000).default(60),
  }).default({}),
});

const LLMConfigSchema = z.object({
  model: z.string().default('claude-sonnet-4-20250514'),
  fallbackModel: z.string().optional(),
  dailyTokenLimit: z.number().min(0).default(100000),
  monthlyTokenLimit: z.number().min(0).default(2000000),
  retryAttempts: z.number().min(0).max(10).default(1),
  retryDelayMs: z.number().min(0).max(30000).default(1000),
  timeoutMs: z.number().min(1000).max(120000).default(30000),
});

const LoggingConfigSchema = z.object({
  level: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  auditFile: z.string().optional(),
});

const AppConfigSchema = z.object({
  mode: ServerModeSchema,
  metabase: MetabaseConfigSchema,
  anthropicApiKey: z.string().optional(),
  llm: LLMConfigSchema,
  security: SecurityConfigSchema,
  logging: LoggingConfigSchema,
  transport: z.enum(['stdio', 'http']).default('stdio'),
  http: z.object({
    port: z.number().min(1).max(65535).default(3000),
    host: z.string().default('127.0.0.1'),
    corsOrigin: z.string().optional(),
    authToken: z.string().optional(),
  }).default({}),
});

// ============================================================================
// Configuration Loader
// ============================================================================

/**
 * Load configuration from environment variables
 */
export function loadConfig(): AppConfig {
  try {
    const rawConfig = {
      mode: process.env.MCP_MODE as ServerMode,
      metabase: {
        url: process.env.METABASE_URL,
        apiKey: process.env.METABASE_API_KEY || undefined,
        timeout: parseIntOrDefault(process.env.METABASE_TIMEOUT, 30000),
        maxRows: parseIntOrDefault(process.env.METABASE_MAX_ROWS, 10000),
      },
      anthropicApiKey: process.env.ANTHROPIC_API_KEY,
      llm: {
        model: process.env.LLM_MODEL,
        fallbackModel: process.env.LLM_FALLBACK_MODEL,
        dailyTokenLimit: parseIntOrDefault(process.env.LLM_DAILY_TOKEN_LIMIT, 100000),
        monthlyTokenLimit: parseIntOrDefault(process.env.LLM_MONTHLY_TOKEN_LIMIT, 2000000),
        retryAttempts: parseIntOrDefault(process.env.LLM_RETRY_ATTEMPTS, 3),
        retryDelayMs: parseIntOrDefault(process.env.LLM_RETRY_DELAY_MS, 1000),
        timeoutMs: parseIntOrDefault(process.env.LLM_TIMEOUT_MS, 30000),
      },
      security: {
        allowedSqlPatterns: parseArrayOrDefault(process.env.ALLOWED_SQL_PATTERNS, ['SELECT', 'WITH']),
        blockedPatterns: parseArrayOrDefault(process.env.BLOCKED_SQL_PATTERNS, undefined),
        rateLimit: {
          requestsPerMinute: parseIntOrDefault(process.env.RATE_LIMIT_REQUESTS_PER_MINUTE, 60),
        },
      },
      logging: {
        level: process.env.LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error',
        auditFile: process.env.AUDIT_LOG_FILE,
      },
      transport: process.env.MCP_TRANSPORT as 'stdio' | 'http',
      http: {
        port: parseIntOrDefault(process.env.MCP_HTTP_PORT, 3000),
        host: process.env.MCP_HTTP_HOST || '127.0.0.1',
        corsOrigin: process.env.MCP_CORS_ORIGIN || undefined,
        authToken: process.env.MCP_AUTH_TOKEN || undefined,
      },
    };

    // Validate and return
    return AppConfigSchema.parse(rawConfig);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issues = error.issues.map(i => `${i.path.join('.')}: ${i.message}`);
      throw new ConfigurationError(
        `Configuration validation failed:\n${issues.join('\n')}`,
        issues[0]?.split(':')[0] || 'unknown'
      );
    }
    throw error;
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

function parseIntOrDefault(value: string | undefined, defaultValue: number): number {
  if (!value) return defaultValue;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

function parseArrayOrDefault(value: string | undefined, defaultValue: string[] | undefined): string[] | undefined {
  if (!value) return defaultValue;
  return value.split(',').map(s => s.trim()).filter(Boolean);
}

// ============================================================================
// Configuration Validation
// ============================================================================

/**
 * Validate configuration at runtime (for validate-config script)
 */
export async function validateConfig(config: AppConfig): Promise<{
  valid: boolean;
  errors: string[];
  warnings: string[];
}> {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check Metabase URL is reachable
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const headers: Record<string, string> = {};
    if (config.metabase.apiKey) {
      headers['X-API-Key'] = config.metabase.apiKey;
    }

    const response = await fetch(`${config.metabase.url}/api/health`, {
      headers,
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      if (response.status === 401) {
        errors.push('Invalid Metabase API key');
      } else {
        errors.push(`Metabase returned status ${response.status}`);
      }
    }
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        errors.push('Metabase connection timed out');
      } else {
        errors.push(`Cannot connect to Metabase: ${error.message}`);
      }
    }
  }

  // Check Anthropic API key if provided
  if (config.anthropicApiKey) {
    // Just check format, don't make API call
    if (!config.anthropicApiKey.startsWith('sk-')) {
      warnings.push('Anthropic API key format looks unusual (expected sk-...)');
    }
  } else {
    warnings.push('ANTHROPIC_API_KEY not set - NLQ features will be disabled');
  }

  // Check mode-specific requirements
  if (config.mode === 'full' && !config.anthropicApiKey) {
    warnings.push('Mode is "full" but ANTHROPIC_API_KEY not set - insight tools will be unavailable');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// ============================================================================
// Logger
// ============================================================================

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export class Logger {
  private level: number;

  constructor(level: LogLevel = 'info') {
    this.level = LOG_LEVELS[level];
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= this.level;
  }

  private formatMessage(level: LogLevel, message: string, meta?: Record<string, unknown>): string {
    const timestamp = new Date().toISOString();
    const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';
    return `[${timestamp}] [${level.toUpperCase()}] ${message}${metaStr}`;
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    if (this.shouldLog('debug')) {
      console.debug(this.formatMessage('debug', message, meta));
    }
  }

  info(message: string, meta?: Record<string, unknown>): void {
    if (this.shouldLog('info')) {
      console.info(this.formatMessage('info', message, meta));
    }
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    if (this.shouldLog('warn')) {
      console.warn(this.formatMessage('warn', message, meta));
    }
  }

  error(message: string, meta?: Record<string, unknown>): void {
    if (this.shouldLog('error')) {
      console.error(this.formatMessage('error', message, meta));
    }
  }
}
