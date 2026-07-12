/**
 * Batch Tools
 * Tools for executing multiple operations in a single call to reduce round trips
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ToolContext } from './types.js';
import { createCompactTextResponse, createErrorResponse } from './types.js';
import { formatQueryResult, formatSchemaResult } from '../utils/response-formatter.js';
import {
  BATCHABLE_WRITE_TOOLS,
  executeWriteOperation,
  isBatchableWriteTool,
  isWriteModeEnabled,
  writeOperationSchemas,
} from './write-operations.js';

const MAX_OPERATIONS = 20;

const readOperationSchemas = [
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
];

function buildOperationSchema(writeEnabled: boolean) {
  const schemas = writeEnabled
    ? [...readOperationSchemas, ...writeOperationSchemas]
    : readOperationSchemas;
  return z.discriminatedUnion(
    'tool',
    schemas as unknown as [z.ZodDiscriminatedUnionOption<'tool'>, ...z.ZodDiscriminatedUnionOption<'tool'>[]]
  );
}

interface Operation {
  tool: string;
  args?: Record<string, any>;
}

async function executeOperation(
  op: Operation,
  ctx: ToolContext,
): Promise<{ tool: string; success: boolean; result?: unknown; error?: string }> {
  if (ctx.toolGate && !ctx.toolGate(op.tool)) {
    return { tool: op.tool, success: false, error: `Tool '${op.tool}' is disabled by server policy` };
  }
  try {
    if (isBatchableWriteTool(op.tool)) {
      if (!isWriteModeEnabled(ctx)) {
        return { tool: op.tool, success: false, error: `Tool '${op.tool}' requires write or full mode` };
      }
      const result = await executeWriteOperation(op.tool, op.args ?? {}, ctx);
      return { tool: op.tool, success: true, result };
    }

    const args = op.args ?? {};
    switch (op.tool) {
      case 'get_dashboard': {
        const dashboard = await ctx.metabaseClient.getDashboard(args.dashboard_id);
        return { tool: op.tool, success: true, result: dashboard };
      }
      case 'get_card': {
        const card = await ctx.metabaseClient.getCard(args.card_id);
        return { tool: op.tool, success: true, result: card };
      }
      case 'execute_card': {
        const result = await ctx.metabaseClient.executeCard(args.card_id, args.parameters);
        const formatted = formatQueryResult(
          result.data.cols,
          result.data.rows,
          result.row_count,
          { format: 'compact', limit: args.limit ?? ctx.config.metabase.maxRows, offset: 0 }
        );
        return { tool: op.tool, success: true, result: formatted };
      }
      case 'get_database_schema': {
        const schema = await ctx.schemaManager.getSchema(args.database_id);
        const formatted = formatSchemaResult(schema, {
          detail: args.detail,
          format: 'compact',
          tables: args.tables,
        });
        return { tool: op.tool, success: true, result: formatted };
      }
      case 'execute_query': {
        const validation = ctx.sqlGuardrails.validate(args.sql);
        if (!validation.valid) {
          return { tool: op.tool, success: false, error: `SQL validation failed: ${validation.errors.join(', ')}` };
        }
        const queryResult = await ctx.metabaseClient.executeQuery(args.database_id, validation.sanitizedSQL);
        const formatted = formatQueryResult(
          queryResult.data.cols,
          queryResult.data.rows,
          queryResult.row_count,
          { format: 'compact', limit: args.limit ?? ctx.config.metabase.maxRows, offset: 0 }
        );
        return { tool: op.tool, success: true, result: formatted };
      }
      case 'search_content': {
        const results = await ctx.metabaseClient.search(args.query, args.type ? [args.type] : undefined);
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
        if (args.collection_id !== undefined) {
          cards = cards.filter(c => c.collection_id === args.collection_id);
        }
        const limit = args.limit ?? 100;
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
      default:
        return { tool: op.tool, success: false, error: `Unknown tool: ${op.tool}` };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { tool: op.tool, success: false, error: message };
  }
}

export function registerBatchTools(server: McpServer, ctx: ToolContext): void {
  const writeEnabled = isWriteModeEnabled(ctx);
  const operationSchema = buildOperationSchema(writeEnabled);

  const readToolList = 'get_dashboard, get_card, execute_card, get_database_schema, execute_query, search_content, list_dashboards, list_databases, list_cards';
  const description = writeEnabled
    ? `Execute multiple operations in a single call. Supports up to ${MAX_OPERATIONS} operations run in parallel. Read tools: ${readToolList}. Write tools (non-destructive only): ${BATCHABLE_WRITE_TOOLS.join(', ')}. Delete operations are not batchable.`
    : `Execute multiple read operations in a single call. Supports up to ${MAX_OPERATIONS} operations run in parallel. Supported tools: ${readToolList}.`;

  server.tool(
    'batch_execute',
    description,
    {
      operations: z.array(operationSchema).min(1).max(MAX_OPERATIONS)
        .describe('Array of operations to execute in parallel'),
    },
    { title: 'Batch Execute', readOnlyHint: !writeEnabled, destructiveHint: writeEnabled, openWorldHint: true },
    async ({ operations }) => {
      try {
        ctx.rateLimiter.checkLimit('read');

        const ops = operations as Operation[];
        const startTime = Date.now();
        const results = await Promise.allSettled(
          ops.map(op => executeOperation(op, ctx))
        );

        const responses = results.map((r, i) => {
          if (r.status === 'fulfilled') {
            return r.value;
          }
          return {
            tool: ops[i].tool,
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
