/**
 * Error Handling Unit Tests
 */

import { describe, it, expect } from 'vitest';
import {
  UserFriendlyError,
  MetabaseError,
  SQLValidationError,
  RateLimitError,
  BudgetExceededError,
  ConfigurationError,
  ErrorMessages,
  wrapError,
} from '../../../src/utils/errors.js';

describe('UserFriendlyError', () => {
  it('creates error with message, suggestion, and code', () => {
    const error = new UserFriendlyError(
      'Something went wrong',
      'Try again later',
      'ERR_TEST'
    );

    expect(error.message).toBe('Something went wrong');
    expect(error.suggestion).toBe('Try again later');
    expect(error.code).toBe('ERR_TEST');
    expect(error.name).toBe('UserFriendlyError');
  });

  it('serializes to JSON correctly', () => {
    const error = new UserFriendlyError('Test error', 'Test suggestion', 'ERR_TEST');
    const json = error.toJSON();

    expect(json).toEqual({
      error: 'Test error',
      suggestion: 'Test suggestion',
      code: 'ERR_TEST',
    });
  });

  it('converts to string with all details', () => {
    const error = new UserFriendlyError('Test error', 'Test suggestion', 'ERR_TEST');
    const str = error.toString();

    expect(str).toContain('ERR_TEST');
    expect(str).toContain('Test error');
    expect(str).toContain('Test suggestion');
  });
});

describe('MetabaseError', () => {
  it('creates error with status code and response', () => {
    const error = new MetabaseError(404, '{"error": "Not found"}');

    expect(error.statusCode).toBe(404);
    expect(error.responseBody).toBe('{"error": "Not found"}');
    expect(error.message).toBe('Metabase API error: 404');
    expect(error.name).toBe('MetabaseError');
  });

  it('serializes to JSON with details', () => {
    const error = new MetabaseError(500, 'Internal Server Error');
    const json = error.toJSON();

    expect(json).toEqual({
      error: 'Metabase API error: 500',
      statusCode: 500,
      details: 'Internal Server Error',
    });
  });
});

describe('SQLValidationError', () => {
  it('creates error with validation errors and warnings', () => {
    const error = new SQLValidationError(
      'SQL validation failed',
      ['Error 1', 'Error 2'],
      ['Warning 1']
    );

    expect(error.message).toBe('SQL validation failed');
    expect(error.errors).toEqual(['Error 1', 'Error 2']);
    expect(error.warnings).toEqual(['Warning 1']);
    expect(error.name).toBe('SQLValidationError');
  });

  it('defaults warnings to empty array', () => {
    const error = new SQLValidationError('Validation failed', ['Error 1']);

    expect(error.warnings).toEqual([]);
  });

  it('serializes to JSON with all details', () => {
    const error = new SQLValidationError(
      'Validation failed',
      ['Blocked pattern'],
      ['Consider adding LIMIT']
    );
    const json = error.toJSON();

    expect(json).toEqual({
      error: 'Validation failed',
      validationErrors: ['Blocked pattern'],
      warnings: ['Consider adding LIMIT'],
    });
  });
});

describe('RateLimitError', () => {
  it('creates error with retry time', () => {
    const error = new RateLimitError(30000);

    expect(error.retryAfterMs).toBe(30000);
    expect(error.message).toBe('Rate limit exceeded. Retry after 30 seconds');
    expect(error.name).toBe('RateLimitError');
  });

  it('serializes to JSON with retry time', () => {
    const error = new RateLimitError(45000);
    const json = error.toJSON();

    expect(json).toEqual({
      error: 'Rate limit exceeded. Retry after 45 seconds',
      retryAfterMs: 45000,
    });
  });

  it('handles sub-second retry times', () => {
    const error = new RateLimitError(500);
    expect(error.message).toBe('Rate limit exceeded. Retry after 1 seconds');
  });
});

describe('BudgetExceededError', () => {
  it('creates error for daily budget', () => {
    const error = new BudgetExceededError('Daily limit reached', 'daily');

    expect(error.message).toBe('Daily limit reached');
    expect(error.budgetType).toBe('daily');
    expect(error.name).toBe('BudgetExceededError');
  });

  it('creates error for monthly budget', () => {
    const error = new BudgetExceededError('Monthly limit reached', 'monthly');

    expect(error.budgetType).toBe('monthly');
  });

  it('provides appropriate suggestion for daily', () => {
    const error = new BudgetExceededError('Daily limit', 'daily');
    const json = error.toJSON();

    expect(json.suggestion).toContain('tomorrow');
    expect(json.suggestion).toContain('execute_query');
  });

  it('provides appropriate suggestion for monthly', () => {
    const error = new BudgetExceededError('Monthly limit', 'monthly');
    const json = error.toJSON();

    expect(json.suggestion).toContain('Monthly');
    expect(json.suggestion).toContain('admin');
  });
});

describe('ConfigurationError', () => {
  it('creates error with field name', () => {
    const error = new ConfigurationError('Invalid API key', 'METABASE_API_KEY');

    expect(error.message).toBe('Invalid API key');
    expect(error.field).toBe('METABASE_API_KEY');
    expect(error.name).toBe('ConfigurationError');
  });

  it('serializes to JSON with field', () => {
    const error = new ConfigurationError('Missing URL', 'METABASE_URL');
    const json = error.toJSON();

    expect(json).toEqual({
      error: 'Missing URL',
      field: 'METABASE_URL',
    });
  });
});

describe('ErrorMessages', () => {
  it('provides METABASE_UNREACHABLE error', () => {
    expect(ErrorMessages.METABASE_UNREACHABLE).toBeInstanceOf(UserFriendlyError);
    expect(ErrorMessages.METABASE_UNREACHABLE.code).toBe('ERR_METABASE_UNREACHABLE');
  });

  it('provides INVALID_API_KEY error', () => {
    expect(ErrorMessages.INVALID_API_KEY).toBeInstanceOf(UserFriendlyError);
    expect(ErrorMessages.INVALID_API_KEY.code).toBe('ERR_INVALID_API_KEY');
  });

  it('provides QUERY_TIMEOUT error', () => {
    expect(ErrorMessages.QUERY_TIMEOUT).toBeInstanceOf(UserFriendlyError);
    expect(ErrorMessages.QUERY_TIMEOUT.code).toBe('ERR_QUERY_TIMEOUT');
  });

  it('provides NLQ_UNAVAILABLE error', () => {
    expect(ErrorMessages.NLQ_UNAVAILABLE).toBeInstanceOf(UserFriendlyError);
    expect(ErrorMessages.NLQ_UNAVAILABLE.code).toBe('ERR_NLQ_UNAVAILABLE');
  });

  it('provides BUDGET_EXCEEDED error', () => {
    expect(ErrorMessages.BUDGET_EXCEEDED).toBeInstanceOf(UserFriendlyError);
    expect(ErrorMessages.BUDGET_EXCEEDED.code).toBe('ERR_BUDGET_EXCEEDED');
  });

  it('provides WRITE_NOT_ALLOWED error', () => {
    expect(ErrorMessages.WRITE_NOT_ALLOWED).toBeInstanceOf(UserFriendlyError);
    expect(ErrorMessages.WRITE_NOT_ALLOWED.code).toBe('ERR_WRITE_NOT_ALLOWED');
  });

  it('provides SQL_BLOCKED error', () => {
    expect(ErrorMessages.SQL_BLOCKED).toBeInstanceOf(UserFriendlyError);
    expect(ErrorMessages.SQL_BLOCKED.code).toBe('ERR_SQL_BLOCKED');
  });
});

describe('wrapError', () => {
  it('returns UserFriendlyError unchanged', () => {
    const original = new UserFriendlyError('Test', 'Suggestion', 'CODE');
    const wrapped = wrapError(original, 'Context');

    expect(wrapped).toBe(original);
  });

  it('maps ECONNREFUSED to METABASE_UNREACHABLE', () => {
    const original = new Error('connect ECONNREFUSED 127.0.0.1:3000');
    const wrapped = wrapError(original, 'Context');

    expect(wrapped).toBe(ErrorMessages.METABASE_UNREACHABLE);
  });

  it('maps ENOTFOUND to METABASE_UNREACHABLE', () => {
    const original = new Error('getaddrinfo ENOTFOUND metabase.invalid');
    const wrapped = wrapError(original, 'Context');

    expect(wrapped).toBe(ErrorMessages.METABASE_UNREACHABLE);
  });

  it('maps 401 to INVALID_API_KEY', () => {
    const original = new Error('Request failed with status 401');
    const wrapped = wrapError(original, 'Context');

    expect(wrapped).toBe(ErrorMessages.INVALID_API_KEY);
  });

  it('maps Unauthorized to INVALID_API_KEY', () => {
    const original = new Error('Unauthorized');
    const wrapped = wrapError(original, 'Context');

    expect(wrapped).toBe(ErrorMessages.INVALID_API_KEY);
  });

  it('maps timeout to QUERY_TIMEOUT', () => {
    const original = new Error('Request timeout');
    const wrapped = wrapError(original, 'Context');

    expect(wrapped).toBe(ErrorMessages.QUERY_TIMEOUT);
  });

  it('maps ETIMEDOUT to QUERY_TIMEOUT', () => {
    const original = new Error('connect ETIMEDOUT');
    const wrapped = wrapError(original, 'Context');

    expect(wrapped).toBe(ErrorMessages.QUERY_TIMEOUT);
  });

  it('wraps unknown errors with context', () => {
    const original = new Error('Something unexpected');
    const wrapped = wrapError(original, 'API call');

    expect(wrapped.message).toBe('API call: Something unexpected');
  });

  it('handles non-Error objects', () => {
    const wrapped = wrapError('string error', 'Context');

    expect(wrapped.message).toBe('Context: Unknown error');
  });

  it('handles null/undefined', () => {
    const wrapped = wrapError(null, 'Context');

    expect(wrapped.message).toBe('Context: Unknown error');
  });
});
