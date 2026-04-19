/**
 * Insight Tools
 * Tools for generating data insights from natural language questions
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ToolContext } from './types.js';
import { createTextResponse, createErrorResponse, createCompactTextResponse } from './types.js';

export function registerInsightTools(server: McpServer, ctx: ToolContext): void {
  // Ensure LLM service is available
  if (!ctx.llmService) {
    ctx.logger.warn('Insight tools not registered: LLM service not available');
    return;
  }

  const llmService = ctx.llmService;

  // ============================================================================
  // ask_data
  // ============================================================================
  server.tool(
    'ask_data',
    'Answer questions about your data using natural language',
    {
      question: z.string().describe('Natural language question about your data'),
      database_id: z.number().describe('Database ID to query'),
      tables: z.array(z.string()).optional().describe('Specific tables to consider'),
      format: z.enum(['default', 'compact']).optional().describe('Response format. "compact" reduces token usage'),
    },
    { title: 'Ask Data Question', readOnlyHint: true, openWorldHint: true },
    async ({ question, database_id, tables, format }) => {
      try {
        ctx.rateLimiter.checkLimit('nlq');

        // Step 1: Get schema
        let schema = await ctx.schemaManager.getSchema(database_id);
        if (tables?.length) {
          schema = await ctx.schemaManager.getFilteredSchema(database_id, tables);
        }

        // Step 2: Generate SQL
        const sqlResult = await llmService.generateSQL({ question, schema });

        // Step 3: Validate SQL
        const validation = ctx.sqlGuardrails.validate(sqlResult.sql);
        if (!validation.valid) {
          ctx.auditLogger.logFailure('ask_data', 'Generated SQL failed validation', {
            question,
            sql: sqlResult.sql,
          });

          return createTextResponse({
            success: false,
            error: 'Could not generate a valid query for your question',
            suggestion: 'Try rephrasing your question or be more specific about the data you want',
          });
        }

        // Step 4: Execute query
        const startTime = Date.now();
        const queryResult = await ctx.metabaseClient.executeQuery(database_id, validation.sanitizedSQL);
        const queryDuration = Date.now() - startTime;

        // Step 5: Generate insights
        const insights = await llmService.generateInsights({
          question,
          data: queryResult,
        });

        ctx.auditLogger.logSuccess('ask_data', {
          question,
          database_id,
          rowCount: queryResult.row_count,
          queryDurationMs: queryDuration,
        });

        const sampleSize = format === 'compact' ? 5 : 10;
        const responseData = {
          success: true,
          answer: insights.summary,
          insights: insights.points,
          recommendations: insights.recommendations,
          data: {
            columns: queryResult.data.cols.map(c => c.name),
            row_count: queryResult.row_count,
            sample: queryResult.data.rows.slice(0, sampleSize),
          },
          sql: validation.sanitizedSQL,
          query_time_ms: queryDuration,
        };

        return format === 'compact'
          ? createCompactTextResponse(responseData)
          : createTextResponse(responseData);
      } catch (error) {
        ctx.auditLogger.logFailure('ask_data', error as Error, { question, database_id });
        return createErrorResponse(error as Error);
      }
    }
  );

  // ============================================================================
  // generate_insights
  // ============================================================================
  server.tool(
    'generate_insights',
    'Auto-generate insights from an existing card/question',
    {
      card_id: z.number().describe('Card ID to analyze'),
      format: z.enum(['default', 'compact']).optional().describe('Response format. "compact" reduces token usage'),
    },
    { title: 'Generate Insights', readOnlyHint: true, openWorldHint: true },
    async ({ card_id, format }) => {
      try {
        ctx.rateLimiter.checkLimit('nlq');

        // Execute the card
        const startTime = Date.now();
        const result = await ctx.metabaseClient.executeCard(card_id);
        const queryDuration = Date.now() - startTime;

        // Get card details for context
        const card = await ctx.metabaseClient.getCard(card_id);

        // Generate insights
        const insights = await llmService.generateInsights({
          question: `What are the key insights from this data? Card name: ${card.name}`,
          data: result,
          context: card.description || undefined,
        });

        ctx.auditLogger.logSuccess('generate_insights', {
          card_id,
          rowCount: result.row_count,
        });

        const responseData = {
          success: true,
          card_name: card.name,
          summary: insights.summary,
          insights: insights.points,
          recommendations: insights.recommendations,
          data: {
            columns: result.data.cols.map(c => c.name),
            row_count: result.row_count,
          },
          query_time_ms: queryDuration,
        };

        return format === 'compact'
          ? createCompactTextResponse(responseData)
          : createTextResponse(responseData);
      } catch (error) {
        ctx.auditLogger.logFailure('generate_insights', error as Error, { card_id });
        return createErrorResponse(error as Error);
      }
    }
  );

  // ============================================================================
  // compare_metrics
  // ============================================================================
  server.tool(
    'compare_metrics',
    'Compare two metrics or time periods',
    {
      question: z.string().describe('Comparison question (e.g., "Compare sales in Q1 vs Q2")'),
      database_id: z.number().describe('Database ID'),
      tables: z.array(z.string()).optional().describe('Specific tables to use'),
      format: z.enum(['default', 'compact']).optional().describe('Response format. "compact" reduces token usage'),
    },
    { title: 'Compare Metrics', readOnlyHint: true, openWorldHint: true },
    async ({ question, database_id, tables, format }) => {
      try {
        ctx.rateLimiter.checkLimit('nlq');

        // Get schema
        let schema = await ctx.schemaManager.getSchema(database_id);
        if (tables?.length) {
          schema = await ctx.schemaManager.getFilteredSchema(database_id, tables);
        }

        // Generate comparison SQL
        const sqlResult = await llmService.generateSQL({
          question: `Generate a SQL query that helps answer this comparison question: ${question}.
                     Include relevant grouping and aggregation for comparison.`,
          schema,
        });

        // Validate and execute
        const validation = ctx.sqlGuardrails.validate(sqlResult.sql);
        if (!validation.valid) {
          return createTextResponse({
            success: false,
            error: 'Could not generate a valid comparison query',
            suggestion: 'Try being more specific about what metrics and time periods to compare',
          });
        }

        const queryResult = await ctx.metabaseClient.executeQuery(database_id, validation.sanitizedSQL);

        // Generate comparison insights
        const insights = await llmService.generateInsights({
          question: `Analyze this comparison data and provide insights: ${question}`,
          data: queryResult,
        });

        ctx.auditLogger.logSuccess('compare_metrics', {
          question,
          database_id,
          rowCount: queryResult.row_count,
        });

        const responseData = {
          success: true,
          comparison_summary: insights.summary,
          key_differences: insights.points,
          recommendations: insights.recommendations,
          data: {
            columns: queryResult.data.cols.map(c => c.name),
            rows: queryResult.data.rows.slice(0, 100),
            row_count: queryResult.row_count,
          },
          sql: validation.sanitizedSQL,
        };

        return format === 'compact'
          ? createCompactTextResponse(responseData)
          : createTextResponse(responseData);
      } catch (error) {
        ctx.auditLogger.logFailure('compare_metrics', error as Error, { question, database_id });
        return createErrorResponse(error as Error);
      }
    }
  );

  // ============================================================================
  // trend_analysis
  // ============================================================================
  server.tool(
    'trend_analysis',
    'Identify trends in time-series data',
    {
      question: z.string().describe('Question about trends (e.g., "What are the sales trends over the past year?")'),
      database_id: z.number().describe('Database ID'),
      tables: z.array(z.string()).optional().describe('Specific tables to use'),
      format: z.enum(['default', 'compact']).optional().describe('Response format. "compact" reduces token usage'),
    },
    { title: 'Trend Analysis', readOnlyHint: true, openWorldHint: true },
    async ({ question, database_id, tables, format }) => {
      try {
        ctx.rateLimiter.checkLimit('nlq');

        // Get schema
        let schema = await ctx.schemaManager.getSchema(database_id);
        if (tables?.length) {
          schema = await ctx.schemaManager.getFilteredSchema(database_id, tables);
        }

        // Generate trend analysis SQL
        const sqlResult = await llmService.generateSQL({
          question: `Generate a SQL query for time-series trend analysis: ${question}.
                     Include date/time grouping (daily, weekly, or monthly as appropriate) and ORDER BY date.`,
          schema,
        });

        // Validate and execute
        const validation = ctx.sqlGuardrails.validate(sqlResult.sql);
        if (!validation.valid) {
          return createTextResponse({
            success: false,
            error: 'Could not generate a valid trend analysis query',
            suggestion: 'Try specifying the date column and metric you want to analyze',
          });
        }

        const queryResult = await ctx.metabaseClient.executeQuery(database_id, validation.sanitizedSQL);

        // Generate trend insights
        const insights = await llmService.generateInsights({
          question: `Analyze the trends in this time-series data: ${question}.
                     Identify patterns, seasonality, growth/decline, and any anomalies.`,
          data: queryResult,
        });

        ctx.auditLogger.logSuccess('trend_analysis', {
          question,
          database_id,
          rowCount: queryResult.row_count,
        });

        const responseData = {
          success: true,
          trend_summary: insights.summary,
          patterns_identified: insights.points,
          recommendations: insights.recommendations,
          data: {
            columns: queryResult.data.cols.map(c => c.name),
            rows: queryResult.data.rows.slice(0, 100),
            row_count: queryResult.row_count,
          },
          sql: validation.sanitizedSQL,
        };

        return format === 'compact'
          ? createCompactTextResponse(responseData)
          : createTextResponse(responseData);
      } catch (error) {
        ctx.auditLogger.logFailure('trend_analysis', error as Error, { question, database_id });
        return createErrorResponse(error as Error);
      }
    }
  );
}
