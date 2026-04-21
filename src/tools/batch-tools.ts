/**
 * Batch Tools
 * Tools for executing multiple operations in a single call to reduce round trips
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ToolContext } from './types.js';
import { createCompactTextResponse, createErrorResponse } from './types.js';
import { formatQueryResult, formatSchemaResult } from '../utils/response-formatter.js';

const MAX_OPERATIONS = 20;

const operationSchema = z.discriminatedUnion('tool', [
  z.object({
    tool: z.literal('get_dashboard'),
    args: z.object({ dashboard_id: z.number() }),
  }),
  z.object({
    tool: z.literal('get_card'),
    args: z.object({ card_id: z.number() }),
  }),
  z.object({
    tool: z.literal('execute_card'),
    args: z.object({
      card_id: z.number(),
      parameters: z.record(z.unknown()).optional(),
      limit: z.number().min(1).max(10000).optional(),
    }),
  }),
  z.object({
    tool: z.literal('get_database_schema'),
    args: z.object({
      database_id: z.number(),
      detail: z.enum(['full', 'tables_only']).optional(),
      tables: z.array(z.string()).optional(),
    }),
  }),
  z.object({
    tool: z.literal('execute_query'),
    args: z.object({
      database_id: z.number(),
      sql: z.string(),
      limit: z.number().min(1).max(10000).optional(),
    }),
  }),
  z.object({
    tool: z.literal('search_content'),
    args: z.object({
      query: z.string(),
      type: z.enum(['card', 'dashboard', 'collection', 'database', 'table']).optional(),
    }),
  }),
  z.object({
    tool: z.literal('list_dashboards'),
    args: z.object({}).optional(),
  }),
  z.object({
    tool: z.literal('list_databases'),
    args: z.object({}).optional(),
  }),
  z.object({
    tool: z.literal('list_cards'),
    args: z.object({
      collection_id: z.number().optional(),
      limit: z.number().min(1).max(100).optional(),
    }).optional(),
  }),
]);

type Operation = z.infer<typeof operationSchema>;

async function executeOperation(
  op: Operation,
  ctx: ToolContext,
): Promise<{ tool: string; success: boolean; result?: unknown; error?: string }> {
  try {
    switch (op.tool) {
      case 'get_dashboard': {
        const dashboard = await ctx.metabaseClient.getDashboard(op.args.dashboard_id);
        return { tool: op.tool, success: true, result: dashboard };
      }
      case 'get_card': {
        const card = await ctx.metabaseClient.getCard(op.args.card_id);
        return { tool: op.tool, success: true, result: card };
      }
      case 'execute_card': {
        const result = await ctx.metabaseClient.executeCard(op.args.card_id, op.args.parameters);
        const formatted = formatQueryResult(
          result.data.cols,
          result.data.rows,
          result.row_count,
          { format: 'compact', limit: op.args.limit ?? ctx.config.metabase.maxRows, offset: 0 }
        );
        return { tool: op.tool, success: true, result: formatted };
      }
      case 'get_database_schema': {
        const schema = await ctx.schemaManager.getSchema(op.args.database_id);
        const formatted = formatSchemaResult(schema, {
          detail: op.args.detail,
          format: 'compact',
          tables: op.args.tables,
        });
        return { tool: op.tool, success: true, result: formatted };
      }
      case 'execute_query': {
        const validation = ctx.sqlGuardrails.validate(op.args.sql);
        if (!validation.valid) {
          return { tool: op.tool, success: false, error: `SQL validation failed: ${validation.errors.join(', ')}` };
        }
        const queryResult = await ctx.metabaseClient.executeQuery(op.args.database_id, validation.sanitizedSQL);
        const formatted = formatQueryResult(
          queryResult.data.cols,
          queryResult.data.rows,
          queryResult.row_count,
          { format: 'compact', limit: op.args.limit ?? ctx.config.metabase.maxRows, offset: 0 }
        );
        return { tool: op.tool, success: true, result: formatted };
      }
      case 'search_content': {
        const results = await ctx.metabaseClient.search(op.args.query, op.args.type ? [op.args.type] : undefined);
        return {
          tool: op.tool,
          success: true,
          result: {
            count: results.length,
            results: results.map(r => ({
              id: r.id, name: r.name, model: r.model,
              collection_id: r.collection_id,
            })),
          },
        };
      }
      case 'list_dashboards': {
        const dashboards = await ctx.metabaseClient.getDashboards();
        return {
          tool: op.tool,
          success: true,
          result: {
            count: dashboards.length,
            dashboards: dashboards.map(d => ({ id: d.id, name: d.name, collection_id: d.collection_id })),
          },
        };
      }
      case 'list_databases': {
        const databases = await ctx.metabaseClient.getDatabases();
        return {
          tool: op.tool,
          success: true,
          result: {
            count: databases.length,
            databases: databases.map(d => ({ id: d.id, name: d.name, engine: d.engine })),
          },
        };
      }
      case 'list_cards': {
        let cards = await ctx.metabaseClient.getCards();
        if (op.args?.collection_id !== undefined) {
          cards = cards.filter(c => c.collection_id === op.args!.collection_id);
        }
        const limit = op.args?.limit ?? 100;
        cards = cards.slice(0, limit);
        return {
          tool: op.tool,
          success: true,
          result: {
            count: cards.length,
            cards: cards.map(c => ({ id: c.id, name: c.name, display: c.display, collection_id: c.collection_id })),
          },
        };
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { tool: op.tool, success: false, error: message };
  }
}

export function registerBatchTools(server: McpServer, ctx: ToolContext): void {
  server.tool(
    'batch_execute',
    `Execute multiple read operations in a single call. Supports up to ${MAX_OPERATIONS} operations run in parallel. Supported tools: get_dashboard, get_card, execute_card, get_database_schema, execute_query, search_content, list_dashboards, list_databases, list_cards.`,
    {
      operations: z.array(operationSchema).min(1).max(MAX_OPERATIONS)
        .describe('Array of operations to execute in parallel'),
    },
    { title: 'Batch Execute', readOnlyHint: true, openWorldHint: true },
    async ({ operations }) => {
      try {
        ctx.rateLimiter.checkLimit('read');

        const startTime = Date.now();
        const results = await Promise.allSettled(
          operations.map(op => executeOperation(op, ctx))
        );

        const responses = results.map((r, i) => {
          if (r.status === 'fulfilled') {
            return r.value;
          }
          return {
            tool: operations[i].tool,
            success: false,
            error: r.reason instanceof Error ? r.reason.message : String(r.reason),
          };
        });

        const succeeded = responses.filter(r => r.success).length;
        const failed = responses.filter(r => !r.success).length;

        ctx.auditLogger.logSuccess('batch_execute', {
          operationCount: operations.length,
          succeeded,
          failed,
          durationMs: Date.now() - startTime,
        });

        return createCompactTextResponse({
          total: operations.length,
          succeeded,
          failed,
          duration_ms: Date.now() - startTime,
          results: responses,
        });
      } catch (error) {
        ctx.auditLogger.logFailure('batch_execute', error as Error);
        return createErrorResponse(error as Error);
      }
    }
  );
}
