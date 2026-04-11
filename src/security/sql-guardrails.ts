/**
 * SQL Guardrails
 * Validates and sanitizes SQL queries to prevent injection and unauthorized operations
 */

import type { SecurityConfig } from '../client/types.js';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  sanitizedSQL: string;
}

export class SQLGuardrails {
  private allowedPatterns: string[];
  private blockedPatterns: string[];

  // Dangerous patterns that indicate SQL injection attempts
  private readonly DANGEROUS_PATTERNS: RegExp[] = [
    /;\s*(DROP|DELETE|UPDATE|INSERT|ALTER|CREATE|TRUNCATE|GRANT|REVOKE)/i,
    /--/,                                    // SQL line comments
    /\/\*/,                                  // Block comment start
    /\*\//,                                  // Block comment end
    /UNION\s+(ALL\s+)?SELECT/i,             // UNION-based injection
    /INTO\s+OUTFILE/i,                      // File write
    /INTO\s+DUMPFILE/i,                     // File dump
    /LOAD_FILE\s*\(/i,                      // File read
    /BENCHMARK\s*\(/i,                      // Time-based blind SQLi
    /SLEEP\s*\(/i,                          // Time-based blind SQLi
    /WAITFOR\s+DELAY/i,                     // SQL Server delay
    /pg_sleep\s*\(/i,                       // PostgreSQL delay
    /INFORMATION_SCHEMA\./i,                // Schema enumeration
    /sys\./i,                               // System tables
    /xp_cmdshell/i,                         // SQL Server command execution
    /sp_executesql/i,                       // Dynamic SQL execution
  ];

  constructor(config: SecurityConfig) {
    this.allowedPatterns = config.allowedSqlPatterns.map(p => p.toUpperCase());
    this.blockedPatterns = config.blockedPatterns.map(p => p.toUpperCase());
  }

  /**
   * Validate a SQL query for safety
   */
  validate(sql: string): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const normalizedSQL = sql.toUpperCase().trim();

    // Check for blocked patterns (DDL/DML keywords)
    for (const pattern of this.blockedPatterns) {
      // Use word boundary matching to avoid false positives
      const regex = new RegExp(`\\b${this.escapeRegex(pattern)}\\b`, 'i');
      if (regex.test(normalizedSQL)) {
        errors.push(`Blocked SQL pattern detected: ${pattern}`);
      }
    }

    // Check that query starts with allowed pattern
    const startsWithAllowed = this.allowedPatterns.some(pattern => {
      const regex = new RegExp(`^\\s*${this.escapeRegex(pattern)}\\b`, 'i');
      return regex.test(normalizedSQL);
    });

    if (!startsWithAllowed && this.allowedPatterns.length > 0) {
      errors.push(`Query must start with: ${this.allowedPatterns.join(' or ')}`);
    }

    // Check for dangerous injection patterns
    for (const pattern of this.DANGEROUS_PATTERNS) {
      if (pattern.test(sql)) {
        errors.push('Potentially dangerous SQL pattern detected');
        break; // One error is enough
      }
    }

    // Check for multiple statements (semicolon followed by more SQL)
    if (/;\s*\S/.test(sql)) {
      errors.push('Multiple SQL statements are not allowed');
    }

    // Warnings for potentially expensive operations
    if (!normalizedSQL.includes('LIMIT')) {
      warnings.push('No LIMIT clause detected — LIMIT 1000 will be enforced automatically');
    }

    if (normalizedSQL.includes('SELECT *')) {
      warnings.push('Consider selecting specific columns instead of *');
    }

    if (/\bLIKE\s+'%/.test(sql)) {
      warnings.push('Leading wildcard in LIKE may cause slow queries');
    }

    if (normalizedSQL.includes('CROSS JOIN')) {
      warnings.push('CROSS JOIN can produce very large result sets');
    }

    // Sanitize the SQL
    const sanitizedSQL = this.sanitize(sql);

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      sanitizedSQL,
    };
  }

  /**
   * Sanitize SQL by removing dangerous constructs and enforcing a row limit
   */
  private sanitize(sql: string): string {
    let sanitized = sql;

    // Remove SQL comments
    sanitized = sanitized
      .replace(/--.*$/gm, '')           // Line comments
      .replace(/\/\*[\s\S]*?\*\//g, '') // Block comments
      .trim();

    // Ensure single statement by taking only content before first semicolon
    const semicolonIndex = sanitized.indexOf(';');
    if (semicolonIndex !== -1) {
      sanitized = sanitized.substring(0, semicolonIndex).trim();
    }

    // Normalize whitespace
    sanitized = sanitized.replace(/\s+/g, ' ');

    // Enforce LIMIT — append if absent to prevent unbounded queries hitting the DB
    if (!/\bLIMIT\s+\d+/i.test(sanitized)) {
      sanitized = `${sanitized} LIMIT 1000`;
    }

    return sanitized;
  }

  /**
   * Escape special regex characters
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Quick check if SQL is allowed (for performance)
   */
  isAllowed(sql: string): boolean {
    return this.validate(sql).valid;
  }

  /**
   * Add a custom blocked pattern at runtime
   */
  addBlockedPattern(pattern: string): void {
    this.blockedPatterns.push(pattern.toUpperCase());
  }

  /**
   * Add a custom allowed pattern at runtime
   */
  addAllowedPattern(pattern: string): void {
    this.allowedPatterns.push(pattern.toUpperCase());
  }
}

/**
 * Create default SQL guardrails for read-only mode
 */
export function createReadOnlyGuardrails(): SQLGuardrails {
  return new SQLGuardrails({
    allowedSqlPatterns: ['SELECT', 'WITH', 'EXPLAIN'],
    blockedPatterns: [
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
      'CALL',
    ],
    rateLimit: { requestsPerMinute: 60 },
  });
}
