/**
 * Custom Error Types
 * User-friendly errors with suggestions for resolution
 */

export class UserFriendlyError extends Error {
  constructor(
    message: string,
    public readonly suggestion: string,
    public readonly code: string
  ) {
    super(message);
    this.name = 'UserFriendlyError';
  }

  toJSON() {
    return {
      error: this.message,
      suggestion: this.suggestion,
      code: this.code,
    };
  }

  toString(): string {
    return `${this.code}: ${this.message}\nSuggestion: ${this.suggestion}`;
  }
}

export class MetabaseError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly responseBody: string
  ) {
    super(`Metabase API error: ${statusCode}`);
    this.name = 'MetabaseError';
  }

  toJSON() {
    return {
      error: this.message,
      statusCode: this.statusCode,
      details: this.responseBody,
    };
  }
}

export class SQLValidationError extends Error {
  constructor(
    message: string,
    public readonly errors: string[],
    public readonly warnings: string[] = []
  ) {
    super(message);
    this.name = 'SQLValidationError';
  }

  toJSON() {
    return {
      error: this.message,
      validationErrors: this.errors,
      warnings: this.warnings,
    };
  }
}

export class RateLimitError extends Error {
  constructor(
    public readonly retryAfterMs: number
  ) {
    super(`Rate limit exceeded. Retry after ${Math.ceil(retryAfterMs / 1000)} seconds`);
    this.name = 'RateLimitError';
  }

  toJSON() {
    return {
      error: this.message,
      retryAfterMs: this.retryAfterMs,
    };
  }
}

export class BudgetExceededError extends Error {
  constructor(
    message: string,
    public readonly budgetType: 'daily' | 'monthly'
  ) {
    super(message);
    this.name = 'BudgetExceededError';
  }

  toJSON() {
    return {
      error: this.message,
      budgetType: this.budgetType,
      suggestion: this.budgetType === 'daily'
        ? 'Wait until tomorrow (midnight UTC) or use execute_query with manual SQL'
        : 'Monthly limit reached. Contact admin to increase limit.',
    };
  }
}

export class ConfigurationError extends Error {
  constructor(
    message: string,
    public readonly field: string
  ) {
    super(message);
    this.name = 'ConfigurationError';
  }

  toJSON() {
    return {
      error: this.message,
      field: this.field,
    };
  }
}

// Pre-defined error messages for common scenarios
export const ErrorMessages = {
  METABASE_UNREACHABLE: new UserFriendlyError(
    'Cannot connect to Metabase',
    'Check METABASE_URL in your configuration and ensure the server is accessible',
    'ERR_METABASE_UNREACHABLE'
  ),

  INVALID_API_KEY: new UserFriendlyError(
    'Invalid Metabase API key',
    'Generate a new API key in Metabase Admin -> Settings -> API Keys',
    'ERR_INVALID_API_KEY'
  ),

  QUERY_TIMEOUT: new UserFriendlyError(
    'Query exceeded timeout limit',
    'Try adding LIMIT clause or optimizing your query. Current timeout: 30s',
    'ERR_QUERY_TIMEOUT'
  ),

  NLQ_UNAVAILABLE: new UserFriendlyError(
    'Natural language query features unavailable',
    'Set ANTHROPIC_API_KEY in your configuration to enable NLQ features',
    'ERR_NLQ_UNAVAILABLE'
  ),

  BUDGET_EXCEEDED: new UserFriendlyError(
    'API usage budget exceeded',
    'Daily or monthly token limit reached. Reset tomorrow or increase limit.',
    'ERR_BUDGET_EXCEEDED'
  ),

  WRITE_NOT_ALLOWED: new UserFriendlyError(
    'Write operations not allowed in current mode',
    'Set MCP_MODE=write or MCP_MODE=full to enable write operations',
    'ERR_WRITE_NOT_ALLOWED'
  ),

  SQL_BLOCKED: new UserFriendlyError(
    'SQL query contains blocked patterns',
    'Only SELECT queries are allowed. DDL/DML statements are blocked for security.',
    'ERR_SQL_BLOCKED'
  ),
};

/**
 * Wrap an error with user-friendly context
 */
export function wrapError(error: unknown, context: string): Error {
  if (error instanceof UserFriendlyError) {
    return error;
  }

  if (error instanceof Error) {
    // Check for common error patterns
    if (error.message.includes('ECONNREFUSED') || error.message.includes('ENOTFOUND')) {
      return ErrorMessages.METABASE_UNREACHABLE;
    }
    if (error.message.includes('401') || error.message.includes('Unauthorized')) {
      return ErrorMessages.INVALID_API_KEY;
    }
    if (error.message.includes('timeout') || error.message.includes('ETIMEDOUT')) {
      return ErrorMessages.QUERY_TIMEOUT;
    }

    return new Error(`${context}: ${error.message}`);
  }

  return new Error(`${context}: Unknown error`);
}
