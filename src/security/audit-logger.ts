/**
 * Audit Logger
 * Logs all operations for security auditing and debugging
 */

import { appendFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';

export interface AuditEvent {
  timestamp: Date;
  action: string;
  details: Record<string, unknown>;
  result: 'success' | 'failure' | 'blocked';
  riskLevel: 'low' | 'medium' | 'high';
  durationMs?: number;
}

export interface AuditLoggerConfig {
  logFile?: string;
  alertOnHighRisk?: boolean;
}

export class AuditLogger {
  private logFile: string | null;
  private alertOnHighRisk: boolean;

  constructor(config: AuditLoggerConfig = {}) {
    this.logFile = config.logFile ?? null;
    this.alertOnHighRisk = config.alertOnHighRisk ?? true;

    // Ensure log directory exists
    if (this.logFile) {
      const dir = dirname(this.logFile);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
    }
  }

  /**
   * Log an audit event
   */
  log(event: Omit<AuditEvent, 'timestamp'>): void {
    const fullEvent: AuditEvent = {
      ...event,
      timestamp: new Date(),
    };

    // Sanitize the event to remove sensitive data
    const sanitized = this.sanitize(fullEvent);

    // Write to file if configured
    if (this.logFile) {
      try {
        appendFileSync(this.logFile, JSON.stringify(sanitized) + '\n');
      } catch (error) {
        console.error('[AuditLogger] Failed to write to log file:', error);
      }
    }

    // Alert on high-risk events
    if (this.alertOnHighRisk && event.riskLevel === 'high') {
      this.alert(sanitized);
    }
  }

  /**
   * Log a successful operation
   */
  logSuccess(action: string, details: Record<string, unknown> = {}, durationMs?: number): void {
    this.log({
      action,
      details,
      result: 'success',
      riskLevel: 'low',
      durationMs,
    });
  }

  /**
   * Log a failed operation
   */
  logFailure(action: string, error: Error | string, details: Record<string, unknown> = {}): void {
    this.log({
      action,
      details: {
        ...details,
        error: error instanceof Error ? error.message : error,
      },
      result: 'failure',
      riskLevel: 'medium',
    });
  }

  /**
   * Log a blocked operation (security violation)
   */
  logBlocked(action: string, reason: string, details: Record<string, unknown> = {}): void {
    this.log({
      action,
      details: {
        ...details,
        blockedReason: reason,
      },
      result: 'blocked',
      riskLevel: 'high',
    });
  }

  /**
   * Log LLM token usage
   */
  logLLMUsage(inputTokens: number, outputTokens: number, model: string): void {
    this.log({
      action: 'llm_usage',
      details: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        model,
      },
      result: 'success',
      riskLevel: 'low',
    });
  }

  /**
   * Log a SQL query execution
   */
  logQuery(databaseId: number, sql: string, rowCount: number, durationMs: number): void {
    this.log({
      action: 'execute_query',
      details: {
        databaseId,
        sql: this.truncateSQL(sql),
        rowCount,
      },
      result: 'success',
      riskLevel: 'low',
      durationMs,
    });
  }

  /**
   * Sanitize event to remove sensitive data
   */
  private sanitize(event: AuditEvent): AuditEvent {
    const sanitized = { ...event, details: { ...event.details } };

    // Remove sensitive fields
    const sensitiveFields = ['apiKey', 'password', 'secret', 'token', 'credential'];
    for (const field of sensitiveFields) {
      if (field in sanitized.details) {
        sanitized.details[field] = '[REDACTED]';
      }
    }

    // Truncate SQL to prevent log bloat
    if (typeof sanitized.details.sql === 'string') {
      sanitized.details.sql = this.truncateSQL(sanitized.details.sql);
    }

    return sanitized;
  }

  /**
   * Truncate long SQL queries
   */
  private truncateSQL(sql: string, maxLength = 500): string {
    if (sql.length <= maxLength) {
      return sql;
    }
    return sql.substring(0, maxLength) + '... [truncated]';
  }

  /**
   * Alert on high-risk events
   */
  private alert(event: AuditEvent): void {
    // In production, this could integrate with Slack, PagerDuty, etc.
    console.error('[SECURITY ALERT]', JSON.stringify(event, null, 2));
  }
}
