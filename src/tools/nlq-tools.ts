/**
 * NLQ-to-SQL Tools
 * Tools for converting natural language questions to SQL queries
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ToolContext } from './types.js';
import { createTextResponse, createErrorResponse } from './types.js';

export function registerNLQTools(server: McpServer, ctx: ToolContext): void {
  // Ensure LLM service is available
  if (!ctx.llmService) {
    ctx.logger.warn('NLQ tools not registered: LLM service not available');
    return;
  }

  const llmService = ctx.llmService;

  // ============================================================================
  // nlq_to_sql
  // ============================================================================
  server.tool(
    'nlq_to_sql',
    'Convert a natural language question to SQL query',
    {
      question: z.string().describe('Natural language question about the data'),
      database_id: z.number().describe('Database ID to query'),
      tables: z.array(z.string()).optional().describe('Specific tables to consider (for large schemas)'),
    },
    { title: 'Natural Language to SQL', readOnlyHint: true, openWorldHint: true },
    async ({ question, database_id, tables }) => {
      try {
        ctx.rateLimiter.checkLimit('nlq');

        // Get schema
        let schema = await ctx.schemaManager.getSchema(database_id);

        // Filter to specific tables if provided
        if (tables?.length) {
          schema = {
            tables: schema.tables.filter(t =>
              tables.some(name => t.name.toLowerCase() === name.toLowerCase())
            ),
          };
        }

        // For large schemas, identify relevant tables first
        if (schema.tables.length > 50) {
          schema = await llmService.identifyRelevantTables(question, schema);
          ctx.logger.debug('Filtered to relevant tables', {
            originalCount: schema.tables.length,
            filteredCount: schema.tables.length,
          });
        }

        // Generate SQL
        const result = await llmService.generateSQL({ question, schema });

        // Validate generated SQL
        const validation = ctx.sqlGuardrails.validate(result.sql);
        if (!validation.valid) {
          ctx.auditLogger.logFailure('nlq_to_sql', 'Generated SQL failed validation', {
            question,
            sql: result.sql,
            errors: validation.errors,
          });

          return createTextResponse({
            success: false,
            error: 'Generated SQL failed validation',
            sql: result.sql,
            validation_errors: validation.errors,
            suggestion: 'Try rephrasing your question or specify the tables to use',
          });
        }

        ctx.auditLogger.logSuccess('nlq_to_sql', {
          question,
          database_id,
          tablesUsed: schema.tables.length,
        });

        return createTextResponse({
          success: true,
          sql: validation.sanitizedSQL,
          explanation: result.explanation,
          warnings: validation.warnings,
        });
      } catch (error) {
        ctx.auditLogger.logFailure('nlq_to_sql', error as Error, { question, database_id });
        return createErrorResponse(error as Error);
      }
    }
  );

  // ============================================================================
  // explain_sql
  // ============================================================================
  server.tool(
    'explain_sql',
    'Explain a SQL query in plain English',
    {
      sql: z.string().describe('SQL query to explain'),
    },
    { title: 'Explain SQL', readOnlyHint: true, openWorldHint: true },
    async ({ sql }) => {
      try {
        ctx.rateLimiter.checkLimit('nlq');

        const explanation = await llmService.explainSQL(sql);
        ctx.auditLogger.logSuccess('explain_sql', { sqlLength: sql.length });

        return createTextResponse({
          sql,
          explanation,
        });
      } catch (error) {
        ctx.auditLogger.logFailure('explain_sql', error as Error);
        return createErrorResponse(error as Error);
      }
    }
  );

  // ============================================================================
  // optimize_sql
  // ============================================================================
  server.tool(
    'optimize_sql',
    'Get suggestions to optimize a SQL query',
    {
      sql: z.string().describe('SQL query to optimize'),
      database_id: z.number().optional().describe('Database ID (to run EXPLAIN if available)'),
    },
    { title: 'Optimize SQL', readOnlyHint: true, openWorldHint: true },
    async ({ sql, database_id }) => {
      try {
        ctx.rateLimiter.checkLimit('nlq');

        // Optionally get execution plan
        let executionPlan: string | undefined;
        if (database_id) {
          // Validate SQL through guardrails before executing EXPLAIN
          const validation = ctx.sqlGuardrails.validate(sql);
          if (validation.valid) {
            try {
              const explainSQL = `EXPLAIN ${validation.sanitizedSQL}`;
              const result = await ctx.metabaseClient.executeQuery(database_id, explainSQL);
              executionPlan = JSON.stringify(result.data.rows, null, 2);
            } catch {
              // EXPLAIN might not be supported, continue without it
            }
          }
        }

        const optimization = await llmService.optimizeSQL(sql, executionPlan);
        ctx.auditLogger.logSuccess('optimize_sql', { sqlLength: sql.length });

        return createTextResponse({
          original_sql: sql,
          suggestions: optimization.suggestions,
          optimized_sql: optimization.optimizedSQL,
        });
      } catch (error) {
        ctx.auditLogger.logFailure('optimize_sql', error as Error);
        return createErrorResponse(error as Error);
      }
    }
  );

  // ============================================================================
  // validate_sql
  // ============================================================================
  server.tool(
    'validate_sql',
    'Check SQL query for syntax issues and security concerns',
    {
      sql: z.string().describe('SQL query to validate'),
    },
    { title: 'Validate SQL', readOnlyHint: true, idempotentHint: true },
    async ({ sql }) => {
      try {
        ctx.rateLimiter.checkLimit('read'); // Use read tier since no LLM call

        const validation = ctx.sqlGuardrails.validate(sql);
        ctx.auditLogger.logSuccess('validate_sql', {
          valid: validation.valid,
          errorCount: validation.errors.length,
          warningCount: validation.warnings.length,
        });

        return createTextResponse({
          valid: validation.valid,
          errors: validation.errors,
          warnings: validation.warnings,
          sanitized_sql: validation.sanitizedSQL,
        });
      } catch (error) {
        ctx.auditLogger.logFailure('validate_sql', error as Error);
        return createErrorResponse(error as Error);
      }
    }
  );
}
