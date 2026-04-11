/**
 * Configuration Unit Tests
 * Tests for loadConfig(), validateConfig(), and Logger class
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadConfig, validateConfig, Logger, type LogLevel } from '../../src/config.js';
import { ConfigurationError } from '../../src/utils/errors.js';
import { silenceConsole, restoreConsole } from '../setup.js';

// ============================================================================
// loadConfig() Tests
// ============================================================================

describe('loadConfig()', () => {
  // Store original environment
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Reset environment to a clean state before each test
    process.env = { ...originalEnv };
    // Clear all metabase-related env vars
    delete process.env.METABASE_URL;
    delete process.env.METABASE_API_KEY;
    delete process.env.METABASE_TIMEOUT;
    delete process.env.METABASE_MAX_ROWS;
    delete process.env.MCP_MODE;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.LLM_MODEL;
    delete process.env.LLM_FALLBACK_MODEL;
    delete process.env.LLM_DAILY_TOKEN_LIMIT;
    delete process.env.LLM_MONTHLY_TOKEN_LIMIT;
    delete process.env.LLM_RETRY_ATTEMPTS;
    delete process.env.LLM_RETRY_DELAY_MS;
    delete process.env.LLM_TIMEOUT_MS;
    delete process.env.ALLOWED_SQL_PATTERNS;
    delete process.env.BLOCKED_SQL_PATTERNS;
    delete process.env.RATE_LIMIT_REQUESTS_PER_MINUTE;
    delete process.env.LOG_LEVEL;
    delete process.env.AUDIT_LOG_FILE;
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  describe('valid configuration', () => {
    it('loads valid configuration from environment variables', () => {
      process.env.METABASE_URL = 'https://metabase.example.com';
      process.env.METABASE_API_KEY = 'mb_test_api_key_12345';

      const config = loadConfig();

      expect(config.metabase.url).toBe('https://metabase.example.com');
      expect(config.metabase.apiKey).toBe('mb_test_api_key_12345');
    });

    it('applies default values when optional vars are not set', () => {
      process.env.METABASE_URL = 'https://metabase.example.com';
      process.env.METABASE_API_KEY = 'test-key';

      const config = loadConfig();

      // Default mode
      expect(config.mode).toBe('read');

      // Default metabase settings
      expect(config.metabase.timeout).toBe(30000);
      expect(config.metabase.maxRows).toBe(10000);

      // Default LLM settings
      expect(config.llm.model).toBe('claude-sonnet-4-20250514');
      expect(config.llm.dailyTokenLimit).toBe(100000);
      expect(config.llm.monthlyTokenLimit).toBe(2000000);
      expect(config.llm.retryAttempts).toBe(3);
      expect(config.llm.retryDelayMs).toBe(1000);
      expect(config.llm.timeoutMs).toBe(30000);

      // Default security settings
      expect(config.security.allowedSqlPatterns).toEqual(['SELECT', 'WITH']);
      expect(config.security.blockedPatterns).toContain('DROP');
      expect(config.security.blockedPatterns).toContain('DELETE');
      expect(config.security.rateLimit.requestsPerMinute).toBe(60);

      // Default logging settings
      expect(config.logging.level).toBe('info');
    });

    it('throws when METABASE_URL is not set', () => {
      process.env.METABASE_API_KEY = 'test-key';

      expect(() => loadConfig()).toThrow(ConfigurationError);
    });

    it('loads all custom values when set', () => {
      process.env.METABASE_URL = 'https://custom.metabase.com';
      process.env.METABASE_API_KEY = 'custom-key';
      process.env.METABASE_TIMEOUT = '60000';
      process.env.METABASE_MAX_ROWS = '5000';
      process.env.MCP_MODE = 'full';
      process.env.ANTHROPIC_API_KEY = 'sk-ant-api03-xxx';
      process.env.LLM_MODEL = 'claude-3-opus-20240229';
      process.env.LLM_FALLBACK_MODEL = 'claude-3-haiku-20240307';
      process.env.LLM_DAILY_TOKEN_LIMIT = '50000';
      process.env.LLM_MONTHLY_TOKEN_LIMIT = '1000000';
      process.env.LLM_RETRY_ATTEMPTS = '5';
      process.env.LLM_RETRY_DELAY_MS = '2000';
      process.env.LLM_TIMEOUT_MS = '60000';
      process.env.RATE_LIMIT_REQUESTS_PER_MINUTE = '120';
      process.env.LOG_LEVEL = 'debug';
      process.env.AUDIT_LOG_FILE = '/var/log/metabase-mcp.log';

      const config = loadConfig();

      expect(config.metabase.url).toBe('https://custom.metabase.com');
      expect(config.metabase.apiKey).toBe('custom-key');
      expect(config.metabase.timeout).toBe(60000);
      expect(config.metabase.maxRows).toBe(5000);
      expect(config.mode).toBe('full');
      expect(config.anthropicApiKey).toBe('sk-ant-api03-xxx');
      expect(config.llm.model).toBe('claude-3-opus-20240229');
      expect(config.llm.fallbackModel).toBe('claude-3-haiku-20240307');
      expect(config.llm.dailyTokenLimit).toBe(50000);
      expect(config.llm.monthlyTokenLimit).toBe(1000000);
      expect(config.llm.retryAttempts).toBe(5);
      expect(config.llm.retryDelayMs).toBe(2000);
      expect(config.llm.timeoutMs).toBe(60000);
      expect(config.security.rateLimit.requestsPerMinute).toBe(120);
      expect(config.logging.level).toBe('debug');
      expect(config.logging.auditFile).toBe('/var/log/metabase-mcp.log');
    });
  });

  describe('METABASE_API_KEY is optional', () => {
    it('loads config without METABASE_API_KEY when not set', () => {
      process.env.METABASE_URL = 'https://metabase.example.com';

      const config = loadConfig();
      expect(config.metabase.apiKey).toBeUndefined();
    });

    it('throws ConfigurationError when METABASE_URL is not set', () => {
      expect(() => loadConfig()).toThrow(ConfigurationError);
    });

    it('treats empty METABASE_API_KEY as undefined', () => {
      process.env.METABASE_URL = 'https://metabase.example.com';
      process.env.METABASE_API_KEY = '';

      const config = loadConfig();
      expect(config.metabase.apiKey).toBeUndefined();
    });
  });

  describe('validation errors for invalid values', () => {
    it('throws ConfigurationError for invalid URL format', () => {
      process.env.METABASE_URL = 'not-a-valid-url';
      process.env.METABASE_API_KEY = 'test-key';

      expect(() => loadConfig()).toThrow(ConfigurationError);
      try {
        loadConfig();
      } catch (error) {
        expect(error).toBeInstanceOf(ConfigurationError);
        expect((error as ConfigurationError).message).toContain('METABASE_URL must be a valid URL');
      }
    });

    it('throws ConfigurationError for URL without protocol', () => {
      process.env.METABASE_URL = 'metabase.example.com';
      process.env.METABASE_API_KEY = 'test-key';

      expect(() => loadConfig()).toThrow(ConfigurationError);
    });

    it('throws ConfigurationError for invalid server mode', () => {
      process.env.METABASE_URL = 'https://metabase.example.com';
      process.env.METABASE_API_KEY = 'test-key';
      process.env.MCP_MODE = 'invalid-mode';

      expect(() => loadConfig()).toThrow(ConfigurationError);
      try {
        loadConfig();
      } catch (error) {
        expect(error).toBeInstanceOf(ConfigurationError);
        expect((error as ConfigurationError).message).toContain('mode');
      }
    });

    it('throws ConfigurationError for invalid log level', () => {
      process.env.METABASE_URL = 'https://metabase.example.com';
      process.env.METABASE_API_KEY = 'test-key';
      process.env.LOG_LEVEL = 'verbose';

      expect(() => loadConfig()).toThrow(ConfigurationError);
    });

    it('uses default when timeout is not a number', () => {
      process.env.METABASE_URL = 'https://metabase.example.com';
      process.env.METABASE_API_KEY = 'test-key';
      process.env.METABASE_TIMEOUT = 'not-a-number';

      const config = loadConfig();
      expect(config.metabase.timeout).toBe(30000);
    });

    it('uses default when maxRows is not a number', () => {
      process.env.METABASE_URL = 'https://metabase.example.com';
      process.env.METABASE_API_KEY = 'test-key';
      process.env.METABASE_MAX_ROWS = 'abc';

      const config = loadConfig();
      expect(config.metabase.maxRows).toBe(10000);
    });

    it('throws ConfigurationError when timeout is below minimum', () => {
      process.env.METABASE_URL = 'https://metabase.example.com';
      process.env.METABASE_API_KEY = 'test-key';
      process.env.METABASE_TIMEOUT = '500'; // Below 1000ms minimum

      expect(() => loadConfig()).toThrow(ConfigurationError);
    });

    it('throws ConfigurationError when timeout exceeds maximum', () => {
      process.env.METABASE_URL = 'https://metabase.example.com';
      process.env.METABASE_API_KEY = 'test-key';
      process.env.METABASE_TIMEOUT = '500000'; // Above 300000ms maximum

      expect(() => loadConfig()).toThrow(ConfigurationError);
    });

    it('throws ConfigurationError when maxRows is below minimum', () => {
      process.env.METABASE_URL = 'https://metabase.example.com';
      process.env.METABASE_API_KEY = 'test-key';
      process.env.METABASE_MAX_ROWS = '0';

      expect(() => loadConfig()).toThrow(ConfigurationError);
    });

    it('throws ConfigurationError when maxRows exceeds maximum', () => {
      process.env.METABASE_URL = 'https://metabase.example.com';
      process.env.METABASE_API_KEY = 'test-key';
      process.env.METABASE_MAX_ROWS = '200000';

      expect(() => loadConfig()).toThrow(ConfigurationError);
    });

    it('throws ConfigurationError when rate limit exceeds maximum', () => {
      process.env.METABASE_URL = 'https://metabase.example.com';
      process.env.METABASE_API_KEY = 'test-key';
      process.env.RATE_LIMIT_REQUESTS_PER_MINUTE = '2000';

      expect(() => loadConfig()).toThrow(ConfigurationError);
    });

    it('throws ConfigurationError when LLM timeout is below minimum', () => {
      process.env.METABASE_URL = 'https://metabase.example.com';
      process.env.METABASE_API_KEY = 'test-key';
      process.env.LLM_TIMEOUT_MS = '500';

      expect(() => loadConfig()).toThrow(ConfigurationError);
    });
  });

  describe('parsing of comma-separated arrays', () => {
    it('parses ALLOWED_SQL_PATTERNS as comma-separated array', () => {
      process.env.METABASE_URL = 'https://metabase.example.com';
      process.env.METABASE_API_KEY = 'test-key';
      process.env.ALLOWED_SQL_PATTERNS = 'SELECT,WITH,SHOW';

      const config = loadConfig();

      expect(config.security.allowedSqlPatterns).toEqual(['SELECT', 'WITH', 'SHOW']);
    });

    it('trims whitespace from comma-separated values', () => {
      process.env.METABASE_URL = 'https://metabase.example.com';
      process.env.METABASE_API_KEY = 'test-key';
      process.env.ALLOWED_SQL_PATTERNS = ' SELECT , WITH , SHOW ';

      const config = loadConfig();

      expect(config.security.allowedSqlPatterns).toEqual(['SELECT', 'WITH', 'SHOW']);
    });

    it('filters empty values from comma-separated arrays', () => {
      process.env.METABASE_URL = 'https://metabase.example.com';
      process.env.METABASE_API_KEY = 'test-key';
      process.env.ALLOWED_SQL_PATTERNS = 'SELECT,,WITH,,,SHOW';

      const config = loadConfig();

      expect(config.security.allowedSqlPatterns).toEqual(['SELECT', 'WITH', 'SHOW']);
    });

    it('parses BLOCKED_SQL_PATTERNS when provided', () => {
      process.env.METABASE_URL = 'https://metabase.example.com';
      process.env.METABASE_API_KEY = 'test-key';
      process.env.BLOCKED_SQL_PATTERNS = 'DROP,DELETE,TRUNCATE';

      const config = loadConfig();

      expect(config.security.blockedPatterns).toEqual(['DROP', 'DELETE', 'TRUNCATE']);
    });

    it('uses default blocked patterns when not provided', () => {
      process.env.METABASE_URL = 'https://metabase.example.com';
      process.env.METABASE_API_KEY = 'test-key';

      const config = loadConfig();

      expect(config.security.blockedPatterns).toContain('DROP');
      expect(config.security.blockedPatterns).toContain('TRUNCATE');
      expect(config.security.blockedPatterns).toContain('DELETE');
      expect(config.security.blockedPatterns).toContain('UPDATE');
      expect(config.security.blockedPatterns).toContain('INSERT');
      expect(config.security.blockedPatterns).toContain('ALTER');
      expect(config.security.blockedPatterns).toContain('CREATE');
      expect(config.security.blockedPatterns).toContain('GRANT');
      expect(config.security.blockedPatterns).toContain('REVOKE');
      expect(config.security.blockedPatterns).toContain('EXEC');
      expect(config.security.blockedPatterns).toContain('EXECUTE');
    });
  });

  describe('server modes', () => {
    it('accepts "read" mode', () => {
      process.env.METABASE_URL = 'https://metabase.example.com';
      process.env.METABASE_API_KEY = 'test-key';
      process.env.MCP_MODE = 'read';

      const config = loadConfig();
      expect(config.mode).toBe('read');
    });

    it('accepts "write" mode', () => {
      process.env.METABASE_URL = 'https://metabase.example.com';
      process.env.METABASE_API_KEY = 'test-key';
      process.env.MCP_MODE = 'write';

      const config = loadConfig();
      expect(config.mode).toBe('write');
    });

    it('accepts "full" mode', () => {
      process.env.METABASE_URL = 'https://metabase.example.com';
      process.env.METABASE_API_KEY = 'test-key';
      process.env.MCP_MODE = 'full';

      const config = loadConfig();
      expect(config.mode).toBe('full');
    });

    it('defaults to "read" mode when not specified', () => {
      process.env.METABASE_URL = 'https://metabase.example.com';
      process.env.METABASE_API_KEY = 'test-key';

      const config = loadConfig();
      expect(config.mode).toBe('read');
    });
  });

  describe('edge cases', () => {
    it('handles URL with trailing slash', () => {
      process.env.METABASE_URL = 'https://metabase.example.com/';
      process.env.METABASE_API_KEY = 'test-key';

      const config = loadConfig();
      expect(config.metabase.url).toBe('https://metabase.example.com/');
    });

    it('handles URL with port', () => {
      process.env.METABASE_URL = 'https://metabase.example.com:3000';
      process.env.METABASE_API_KEY = 'test-key';

      const config = loadConfig();
      expect(config.metabase.url).toBe('https://metabase.example.com:3000');
    });

    it('handles URL with path', () => {
      process.env.METABASE_URL = 'https://example.com/metabase';
      process.env.METABASE_API_KEY = 'test-key';

      const config = loadConfig();
      expect(config.metabase.url).toBe('https://example.com/metabase');
    });

    it('handles localhost URL', () => {
      process.env.METABASE_URL = 'http://localhost:3000';
      process.env.METABASE_API_KEY = 'test-key';

      const config = loadConfig();
      expect(config.metabase.url).toBe('http://localhost:3000');
    });

    it('handles negative number parsing (uses default)', () => {
      process.env.METABASE_URL = 'https://metabase.example.com';
      process.env.METABASE_API_KEY = 'test-key';
      process.env.LLM_DAILY_TOKEN_LIMIT = '-100';

      // Negative values will be parsed but fail validation
      // The schema has min(0) for dailyTokenLimit
      expect(() => loadConfig()).toThrow(ConfigurationError);
    });

    it('handles float number parsing (truncates to integer)', () => {
      process.env.METABASE_URL = 'https://metabase.example.com';
      process.env.METABASE_API_KEY = 'test-key';
      process.env.METABASE_MAX_ROWS = '5000.9';

      const config = loadConfig();
      expect(config.metabase.maxRows).toBe(5000);
    });
  });
});

// ============================================================================
// validateConfig() Tests
// ============================================================================

describe('validateConfig()', () => {
  beforeEach(() => {
    silenceConsole();
    // Mock global fetch
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    restoreConsole();
    vi.unstubAllGlobals();
  });

  const createTestConfig = (overrides: Record<string, unknown> = {}) => ({
    mode: 'read' as const,
    metabase: {
      url: 'https://metabase.example.com',
      apiKey: 'test-api-key',
      timeout: 30000,
      maxRows: 10000,
    },
    llm: {
      model: 'claude-sonnet-4-20250514',
      dailyTokenLimit: 100000,
      monthlyTokenLimit: 2000000,
      retryAttempts: 3,
      retryDelayMs: 1000,
      timeoutMs: 30000,
    },
    security: {
      allowedSqlPatterns: ['SELECT', 'WITH'],
      blockedPatterns: ['DROP', 'DELETE'],
      rateLimit: {
        requestsPerMinute: 60,
      },
    },
    logging: {
      level: 'info' as const,
    },
    ...overrides,
  });

  describe('Metabase connectivity validation', () => {
    it('returns valid when Metabase is reachable and responds OK', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
      } as Response);

      const config = createTestConfig();
      const result = await validateConfig(config);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(fetch).toHaveBeenCalledWith(
        'https://metabase.example.com/api/health',
        expect.objectContaining({
          headers: { 'X-API-Key': 'test-api-key' },
        })
      );
    });

    it('returns error when Metabase returns 401 (invalid API key)', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 401,
      } as Response);

      const config = createTestConfig();
      const result = await validateConfig(config);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Invalid Metabase API key');
    });

    it('returns error when Metabase returns non-OK status', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 500,
      } as Response);

      const config = createTestConfig();
      const result = await validateConfig(config);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Metabase returned status 500');
    });

    it('returns error when connection times out', async () => {
      const abortError = new Error('Aborted');
      abortError.name = 'AbortError';
      vi.mocked(fetch).mockRejectedValueOnce(abortError);

      const config = createTestConfig();
      const result = await validateConfig(config);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Metabase connection timed out');
    });

    it('returns error when connection fails', async () => {
      vi.mocked(fetch).mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const config = createTestConfig();
      const result = await validateConfig(config);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Cannot connect to Metabase: ECONNREFUSED');
    });

    it('returns error when DNS resolution fails', async () => {
      vi.mocked(fetch).mockRejectedValueOnce(new Error('getaddrinfo ENOTFOUND'));

      const config = createTestConfig();
      const result = await validateConfig(config);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Cannot connect to Metabase: getaddrinfo ENOTFOUND');
    });
  });

  describe('API key format warnings', () => {
    it('warns when Anthropic API key does not start with sk-', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({ ok: true, status: 200 } as Response);

      const config = createTestConfig({
        anthropicApiKey: 'invalid-format-key',
      });
      const result = await validateConfig(config);

      expect(result.warnings).toContain(
        'Anthropic API key format looks unusual (expected sk-...)'
      );
    });

    it('does not warn when Anthropic API key starts with sk-', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({ ok: true, status: 200 } as Response);

      const config = createTestConfig({
        anthropicApiKey: 'sk-ant-api03-valid-key',
      });
      const result = await validateConfig(config);

      expect(result.warnings).not.toContain(
        'Anthropic API key format looks unusual (expected sk-...)'
      );
    });

    it('warns when Anthropic API key is not provided', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({ ok: true, status: 200 } as Response);

      const config = createTestConfig();
      const result = await validateConfig(config);

      expect(result.warnings).toContain('ANTHROPIC_API_KEY not set - NLQ features will be disabled');
    });
  });

  describe('mode-specific warnings', () => {
    it('warns when mode is "full" but Anthropic API key is not set', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({ ok: true, status: 200 } as Response);

      const config = createTestConfig({
        mode: 'full' as const,
      });
      const result = await validateConfig(config);

      expect(result.warnings).toContain(
        'Mode is "full" but ANTHROPIC_API_KEY not set - insight tools will be unavailable'
      );
    });

    it('does not warn for "full" mode when Anthropic API key is set', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({ ok: true, status: 200 } as Response);

      const config = createTestConfig({
        mode: 'full' as const,
        anthropicApiKey: 'sk-ant-api03-xxx',
      });
      const result = await validateConfig(config);

      expect(result.warnings).not.toContain(
        'Mode is "full" but ANTHROPIC_API_KEY not set - insight tools will be unavailable'
      );
    });

    it('does not warn about full mode when mode is "read"', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({ ok: true, status: 200 } as Response);

      const config = createTestConfig({
        mode: 'read' as const,
      });
      const result = await validateConfig(config);

      expect(result.warnings).not.toContain(
        'Mode is "full" but ANTHROPIC_API_KEY not set - insight tools will be unavailable'
      );
    });

    it('does not warn about full mode when mode is "write"', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({ ok: true, status: 200 } as Response);

      const config = createTestConfig({
        mode: 'write' as const,
      });
      const result = await validateConfig(config);

      expect(result.warnings).not.toContain(
        'Mode is "full" but ANTHROPIC_API_KEY not set - insight tools will be unavailable'
      );
    });
  });

  describe('combined validation results', () => {
    it('can return both errors and warnings', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 503,
      } as Response);

      const config = createTestConfig({
        mode: 'full' as const,
      });
      const result = await validateConfig(config);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('returns valid with warnings when only warnings exist', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({ ok: true, status: 200 } as Response);

      const config = createTestConfig({
        mode: 'full' as const,
      });
      const result = await validateConfig(config);

      expect(result.valid).toBe(true);
      expect(result.warnings.length).toBeGreaterThan(0);
    });
  });
});

// ============================================================================
// Logger Tests
// ============================================================================

describe('Logger', () => {
  let consoleDebugSpy: ReturnType<typeof vi.spyOn>;
  let consoleInfoSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleDebugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('log levels', () => {
    it('creates logger with default "info" level', () => {
      const logger = new Logger();
      logger.info('test message');
      expect(consoleInfoSpy).toHaveBeenCalled();
    });

    it('creates logger with specified level', () => {
      const logger = new Logger('error');
      logger.error('test message');
      expect(consoleErrorSpy).toHaveBeenCalled();
    });
  });

  describe('debug level', () => {
    it('logs debug messages when level is debug', () => {
      const logger = new Logger('debug');
      logger.debug('debug message');
      expect(consoleDebugSpy).toHaveBeenCalled();
    });

    it('logs info messages when level is debug', () => {
      const logger = new Logger('debug');
      logger.info('info message');
      expect(consoleInfoSpy).toHaveBeenCalled();
    });

    it('logs warn messages when level is debug', () => {
      const logger = new Logger('debug');
      logger.warn('warn message');
      expect(consoleWarnSpy).toHaveBeenCalled();
    });

    it('logs error messages when level is debug', () => {
      const logger = new Logger('debug');
      logger.error('error message');
      expect(consoleErrorSpy).toHaveBeenCalled();
    });
  });

  describe('info level', () => {
    it('does not log debug messages when level is info', () => {
      const logger = new Logger('info');
      logger.debug('debug message');
      expect(consoleDebugSpy).not.toHaveBeenCalled();
    });

    it('logs info messages when level is info', () => {
      const logger = new Logger('info');
      logger.info('info message');
      expect(consoleInfoSpy).toHaveBeenCalled();
    });

    it('logs warn messages when level is info', () => {
      const logger = new Logger('info');
      logger.warn('warn message');
      expect(consoleWarnSpy).toHaveBeenCalled();
    });

    it('logs error messages when level is info', () => {
      const logger = new Logger('info');
      logger.error('error message');
      expect(consoleErrorSpy).toHaveBeenCalled();
    });
  });

  describe('warn level', () => {
    it('does not log debug messages when level is warn', () => {
      const logger = new Logger('warn');
      logger.debug('debug message');
      expect(consoleDebugSpy).not.toHaveBeenCalled();
    });

    it('does not log info messages when level is warn', () => {
      const logger = new Logger('warn');
      logger.info('info message');
      expect(consoleInfoSpy).not.toHaveBeenCalled();
    });

    it('logs warn messages when level is warn', () => {
      const logger = new Logger('warn');
      logger.warn('warn message');
      expect(consoleWarnSpy).toHaveBeenCalled();
    });

    it('logs error messages when level is warn', () => {
      const logger = new Logger('warn');
      logger.error('error message');
      expect(consoleErrorSpy).toHaveBeenCalled();
    });
  });

  describe('error level', () => {
    it('does not log debug messages when level is error', () => {
      const logger = new Logger('error');
      logger.debug('debug message');
      expect(consoleDebugSpy).not.toHaveBeenCalled();
    });

    it('does not log info messages when level is error', () => {
      const logger = new Logger('error');
      logger.info('info message');
      expect(consoleInfoSpy).not.toHaveBeenCalled();
    });

    it('does not log warn messages when level is error', () => {
      const logger = new Logger('error');
      logger.warn('warn message');
      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });

    it('logs error messages when level is error', () => {
      const logger = new Logger('error');
      logger.error('error message');
      expect(consoleErrorSpy).toHaveBeenCalled();
    });
  });

  describe('message formatting', () => {
    it('formats message with timestamp and level', () => {
      const logger = new Logger('info');
      logger.info('test message');

      const call = consoleInfoSpy.mock.calls[0][0];
      expect(call).toMatch(/^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\]/);
      expect(call).toContain('[INFO]');
      expect(call).toContain('test message');
    });

    it('formats debug level correctly', () => {
      const logger = new Logger('debug');
      logger.debug('debug message');

      const call = consoleDebugSpy.mock.calls[0][0];
      expect(call).toContain('[DEBUG]');
    });

    it('formats warn level correctly', () => {
      const logger = new Logger('warn');
      logger.warn('warn message');

      const call = consoleWarnSpy.mock.calls[0][0];
      expect(call).toContain('[WARN]');
    });

    it('formats error level correctly', () => {
      const logger = new Logger('error');
      logger.error('error message');

      const call = consoleErrorSpy.mock.calls[0][0];
      expect(call).toContain('[ERROR]');
    });

    it('includes metadata when provided', () => {
      const logger = new Logger('info');
      logger.info('test message', { userId: 123, action: 'login' });

      const call = consoleInfoSpy.mock.calls[0][0];
      expect(call).toContain('test message');
      expect(call).toContain('"userId":123');
      expect(call).toContain('"action":"login"');
    });

    it('does not include metadata when not provided', () => {
      const logger = new Logger('info');
      logger.info('test message');

      const call = consoleInfoSpy.mock.calls[0][0];
      expect(call).not.toContain('{');
      expect(call).toMatch(/test message$/);
    });

    it('handles complex metadata objects', () => {
      const logger = new Logger('info');
      logger.info('complex metadata', {
        nested: { a: 1, b: 2 },
        array: [1, 2, 3],
        string: 'value',
      });

      const call = consoleInfoSpy.mock.calls[0][0];
      expect(call).toContain('"nested":{"a":1,"b":2}');
      expect(call).toContain('"array":[1,2,3]');
    });

    it('handles empty metadata object', () => {
      const logger = new Logger('info');
      logger.info('empty metadata', {});

      const call = consoleInfoSpy.mock.calls[0][0];
      expect(call).toContain('{}');
    });
  });

  describe('log level filtering', () => {
    const levels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
    const levelIndex = { debug: 0, info: 1, warn: 2, error: 3 };

    levels.forEach((configLevel) => {
      levels.forEach((messageLevel) => {
        const shouldLog = levelIndex[messageLevel] >= levelIndex[configLevel];

        it(`${shouldLog ? 'logs' : 'does not log'} ${messageLevel} when level is ${configLevel}`, () => {
          const logger = new Logger(configLevel);
          const spy = {
            debug: consoleDebugSpy,
            info: consoleInfoSpy,
            warn: consoleWarnSpy,
            error: consoleErrorSpy,
          }[messageLevel];

          logger[messageLevel]('test message');

          if (shouldLog) {
            expect(spy).toHaveBeenCalled();
          } else {
            expect(spy).not.toHaveBeenCalled();
          }
        });
      });
    });
  });
});
