/**
 * Workflow Tools
 * CodeAct-inspired composable pipelines for multi-step operations.
 * Eliminates multi-turn round trips by chaining tools in a single call.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ToolContext } from './types.js';
import { createCompactTextResponse, createErrorResponse } from './types.js';
import { formatQueryResult, formatSchemaResult } from '../utils/response-formatter.js';
import { SQLValidationError } from '../utils/errors.js';

const MAX_STEPS = 10;

const stepSchema = z.object({
  name: z.string().describe('Unique step name for referencing results (e.g. "find_dashboards")'),
  tool: z.enum([
    'list_dashboards', 'get_dashboard', 'list_cards', 'get_card',
    'execute_card', 'list_databases', 'get_database_schema',
    'execute_query', 'search_content', 'get_collections',
  ]).describe('Tool to execute'),
  args: z.record(z.unknown()).optional()
    .describe('Tool arguments. Use "$stepName.path.to.value" to reference previous step results'),
  on_error: z.enum(['abort', 'continue']).optional()
    .describe('Error handling: "abort" stops the workflow (default), "continue" skips to next step'),
});

type Step = z.infer<typeof stepSchema>;

/**
 * Resolve template references like "$find.dashboards[0].id" against workflow context.
 */
function resolveValue(value: unknown, context: Record<string, unknown>): unknown {
  if (typeof value === 'string' && value.startsWith('$')) {
    const path = value.slice(1); // Remove leading $
    return getNestedValue(context, path);
  }
  if (Array.isArray(value)) {
    return value.map(v => resolveValue(v, context));
  }
  if (value !== null && typeof value === 'object') {
    const resolved: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      resolved[k] = resolveValue(v, context);
    }
    return resolved;
  }
  return value;
}

/**
 * Navigate a nested object by dot/bracket path.
 * Supports: "step.dashboards[0].id", "step.results[2].name"
 */
function getNestedValue(obj: unknown, path: string): unknown {
  const parts = path.split(/\.|\[(\d+)\]/).filter(Boolean);
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) {
      const idx = parseInt(part, 10);
      if (!isNaN(idx)) {
        current = current[idx];
        continue;
      }
    }
    if (typeof current === 'object' && current !== null) {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return current;
}

async function executeStep(
  step: Step,
  ctx: ToolContext,
  workflowContext: Record<string, unknown>,
): Promise<unknown> {
  const args = step.args ? resolveValue(step.args, workflowContext) as Record<string, unknown> : {};

  switch (step.tool) {
    case 'list_dashboards': {
      const dashboards = await ctx.metabaseClient.getDashboards();
      return {
        count: dashboards.length,
        dashboards: dashboards.map(d => ({
          id: d.id, name: d.name, description: d.description, collection_id: d.collection_id,
        })),
      };
    }
    case 'get_dashboard': {
      const id = args.dashboard_id as number;
      return await ctx.metabaseClient.getDashboard(id);
    }
    case 'list_cards': {
      let cards = await ctx.metabaseClient.getCards();
      if (args.collection_id !== undefined) {
        cards = cards.filter(c => c.collection_id === (args.collection_id as number));
      }
      const limit = (args.limit as number) ?? 100;
      cards = cards.slice(0, limit);
      return {
        count: cards.length,
        cards: cards.map(c => ({
          id: c.id, name: c.name, display: c.display, database_id: c.database_id, collection_id: c.collection_id,
        })),
      };
    }
    case 'get_card': {
      const id = args.card_id as number;
      return await ctx.metabaseClient.getCard(id);
    }
    case 'execute_card': {
      const id = args.card_id as number;
      const params = args.parameters as Record<string, unknown> | undefined;
      const result = await ctx.metabaseClient.executeCard(id, params);
      return formatQueryResult(
        result.data.cols,
        result.data.rows,
        result.row_count,
        {
          format: 'compact',
          limit: (args.limit as number) ?? ctx.config.metabase.maxRows,
          offset: 0,
        }
      );
    }
    case 'list_databases': {
      const databases = await ctx.metabaseClient.getDatabases();
      return {
        count: databases.length,
        databases: databases.map(d => ({ id: d.id, name: d.name, engine: d.engine })),
      };
    }
    case 'get_database_schema': {
      const id = args.database_id as number;
      const schema = await ctx.schemaManager.getSchema(id);
      return formatSchemaResult(schema, {
        detail: args.detail as 'full' | 'tables_only' | undefined,
        format: 'compact',
        tables: args.tables as string[] | undefined,
      });
    }
    case 'execute_query': {
      const dbId = args.database_id as number;
      const sql = args.sql as string;
      const validation = ctx.sqlGuardrails.validate(sql);
      if (!validation.valid) {
        throw new SQLValidationError('SQL validation failed', validation.errors, validation.warnings);
      }
      const result = await ctx.metabaseClient.executeQuery(dbId, validation.sanitizedSQL);
      return formatQueryResult(
        result.data.cols,
        result.data.rows,
        result.row_count,
        {
          format: 'compact',
          limit: (args.limit as number) ?? ctx.config.metabase.maxRows,
          offset: 0,
        }
      );
    }
    case 'search_content': {
      const query = args.query as string;
      const type = args.type as string | undefined;
      const results = await ctx.metabaseClient.search(query, type ? [type] : undefined);
      return {
        count: results.length,
        results: results.map(r => ({
          id: r.id, name: r.name, description: r.description,
          model: r.model, collection_id: r.collection_id,
        })),
      };
    }
    case 'get_collections': {
      const collections = await ctx.metabaseClient.getCollections();
      return {
        count: collections.length,
        collections: collections.map(c => ({
          id: c.id, name: c.name, description: c.description,
        })),
      };
    }
    default:
      throw new Error(`Unknown tool: ${step.tool}`);
  }
}

export function registerWorkflowTools(server: McpServer, ctx: ToolContext): void {
  server.tool(
    'run_workflow',
    `Execute a multi-step workflow pipeline in a single call. Steps run sequentially and can reference previous step results using "$stepName.path" syntax. Example: search for dashboards, then get details of the first result, then execute its cards — all in one call. Max ${MAX_STEPS} steps.`,
    {
      steps: z.array(stepSchema).min(1).max(MAX_STEPS)
        .describe('Ordered pipeline steps. Each step can reference results from previous steps.'),
    },
    { title: 'Run Workflow', readOnlyHint: true, openWorldHint: true },
    async ({ steps }) => {
      try {
        ctx.rateLimiter.checkLimit('read');

        // Validate step names are unique
        const names = new Set<string>();
        for (const step of steps) {
          if (names.has(step.name)) {
            return createErrorResponse(new Error(`Duplicate step name: "${step.name}"`));
          }
          names.add(step.name);
        }

        const workflowContext: Record<string, unknown> = {};
        const stepResults: Array<{
          name: string;
          tool: string;
          success: boolean;
          result?: unknown;
          error?: string;
          duration_ms: number;
        }> = [];

        const workflowStart = Date.now();

        for (const step of steps) {
          const stepStart = Date.now();
          try {
            const result = await executeStep(step, ctx, workflowContext);
            workflowContext[step.name] = result;
            stepResults.push({
              name: step.name,
              tool: step.tool,
              success: true,
              result,
              duration_ms: Date.now() - stepStart,
            });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            stepResults.push({
              name: step.name,
              tool: step.tool,
              success: false,
              error: message,
              duration_ms: Date.now() - stepStart,
            });

            if (step.on_error !== 'continue') {
              // Abort: return partial results
              ctx.auditLogger.logFailure('run_workflow', error as Error, {
                abortedAt: step.name,
                completedSteps: stepResults.length - 1,
              });
              return createCompactTextResponse({
                completed: false,
                aborted_at: step.name,
                total_steps: steps.length,
                completed_steps: stepResults.length - 1,
                duration_ms: Date.now() - workflowStart,
                steps: stepResults,
              });
            }
          }
        }

        const succeeded = stepResults.filter(r => r.success).length;
        ctx.auditLogger.logSuccess('run_workflow', {
          totalSteps: steps.length,
          succeeded,
          failed: steps.length - succeeded,
          durationMs: Date.now() - workflowStart,
        });

        return createCompactTextResponse({
          completed: true,
          total_steps: steps.length,
          succeeded,
          failed: steps.length - succeeded,
          duration_ms: Date.now() - workflowStart,
          steps: stepResults,
        });
      } catch (error) {
        ctx.auditLogger.logFailure('run_workflow', error as Error);
        return createErrorResponse(error as Error);
      }
    }
  );
}
