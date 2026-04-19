/**
 * Read-Only Tools
 * Tools for querying Metabase data without modifications
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ToolContext } from './types.js';
import { createTextResponse, createErrorResponse, createCompactTextResponse } from './types.js';
import { formatQueryResult, formatSchemaResult } from '../utils/response-formatter.js';
import { SQLValidationError } from '../utils/errors.js';

export function registerReadTools(server: McpServer, ctx: ToolContext): void {
  // ============================================================================
  // list_dashboards
  // ============================================================================
  server.tool(
    'list_dashboards',
    'List all dashboards in Metabase',
    {},
    { title: 'List Dashboards', readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    async () => {
      try {
        ctx.rateLimiter.checkLimit('read');
        const dashboards = await ctx.metabaseClient.getDashboards();
        ctx.auditLogger.logSuccess('list_dashboards', { count: dashboards.length });

        return createTextResponse({
          count: dashboards.length,
          dashboards: dashboards.map(d => ({
            id: d.id,
            name: d.name,
            description: d.description,
            collection_id: d.collection_id,
            archived: d.archived,
          })),
        });
      } catch (error) {
        ctx.auditLogger.logFailure('list_dashboards', error as Error);
        return createErrorResponse(error as Error);
      }
    }
  );

  // ============================================================================
  // get_dashboard
  // ============================================================================
  server.tool(
    'get_dashboard',
    'Get dashboard details including its cards',
    {
      dashboard_id: z.number().describe('Dashboard ID'),
    },
    { title: 'Get Dashboard', readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    async ({ dashboard_id }) => {
      try {
        ctx.rateLimiter.checkLimit('read');
        const dashboard = await ctx.metabaseClient.getDashboard(dashboard_id);
        ctx.auditLogger.logSuccess('get_dashboard', { dashboard_id });

        return createTextResponse(dashboard);
      } catch (error) {
        ctx.auditLogger.logFailure('get_dashboard', error as Error, { dashboard_id });
        return createErrorResponse(error as Error);
      }
    }
  );

  // ============================================================================
  // list_cards
  // ============================================================================
  server.tool(
    'list_cards',
    'List questions/cards in Metabase. Returns up to 100 cards. Use search_content for discovery.',
    {
      collection_id: z.number().optional().describe('Filter by collection ID'),
      limit: z.number().min(1).max(100).default(100).optional().describe('Max cards to return (default 100)'),
    },
    { title: 'List Cards', readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    async ({ collection_id, limit }) => {
      try {
        ctx.rateLimiter.checkLimit('read');
        // Metabase /card endpoint doesn't support server-side filtering/pagination,
        // so we fetch all and filter client-side. Truncation limits response size.
        let cards = await ctx.metabaseClient.getCards();
        if (collection_id !== undefined) {
          cards = cards.filter(c => c.collection_id === collection_id);
        }
        const maxCards = limit ?? 100;
        const truncated = cards.length > maxCards;
        cards = cards.slice(0, maxCards);
        ctx.auditLogger.logSuccess('list_cards', { count: cards.length });

        return createTextResponse({
          count: cards.length,
          ...(truncated ? { truncated: true, message: `Showing first ${maxCards} of many cards. Use search_content or filter by collection_id for better results.` } : {}),
          cards: cards.map(c => ({
            id: c.id,
            name: c.name,
            description: c.description,
            display: c.display,
            database_id: c.database_id,
            collection_id: c.collection_id,
            archived: c.archived,
          })),
        });
      } catch (error) {
        ctx.auditLogger.logFailure('list_cards', error as Error);
        return createErrorResponse(error as Error);
      }
    }
  );

  // ============================================================================
  // get_card
  // ============================================================================
  server.tool(
    'get_card',
    'Get details of a specific question/card',
    {
      card_id: z.number().describe('Card ID'),
    },
    { title: 'Get Card', readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    async ({ card_id }) => {
      try {
        ctx.rateLimiter.checkLimit('read');
        const card = await ctx.metabaseClient.getCard(card_id);
        ctx.auditLogger.logSuccess('get_card', { card_id });

        return createTextResponse(card);
      } catch (error) {
        ctx.auditLogger.logFailure('get_card', error as Error, { card_id });
        return createErrorResponse(error as Error);
      }
    }
  );

  // ============================================================================
  // execute_card
  // ============================================================================
  server.tool(
    'execute_card',
    'Execute an existing question/card and get results',
    {
      card_id: z.number().describe('Card ID to execute'),
      parameters: z.record(z.unknown()).optional().describe('Optional parameters for parameterized queries'),
      fields: z.array(z.string()).optional().describe('Column names to include in results (default: all)'),
      format: z.enum(['default', 'compact']).optional().describe('Response format. "compact" reduces token usage by ~50%'),
      limit: z.number().min(1).max(10000).optional().describe('Max rows to return (default: server maxRows setting)'),
      offset: z.number().min(0).optional().describe('Row offset for pagination'),
    },
    { title: 'Execute Card', readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    async ({ card_id, parameters, fields, format, limit, offset }) => {
      try {
        ctx.rateLimiter.checkLimit('read');
        const startTime = Date.now();
        const result = await ctx.metabaseClient.executeCard(card_id, parameters);
        const duration = Date.now() - startTime;

        ctx.auditLogger.logSuccess('execute_card', {
          card_id,
          rowCount: result.row_count,
          durationMs: duration,
        });

        const formatted = formatQueryResult(
          result.data.cols,
          result.data.rows,
          result.row_count,
          {
            fields,
            format,
            limit: limit ?? ctx.config.metabase.maxRows,
            offset: offset ?? 0,
          }
        );

        const response = {
          ...formatted,
          execution_time_ms: duration,
        };

        return format === 'compact'
          ? createCompactTextResponse(response)
          : createTextResponse(response);
      } catch (error) {
        ctx.auditLogger.logFailure('execute_card', error as Error, { card_id });
        return createErrorResponse(error as Error);
      }
    }
  );

  // ============================================================================
  // list_databases
  // ============================================================================
  server.tool(
    'list_databases',
    'List all connected databases',
    {},
    { title: 'List Databases', readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    async () => {
      try {
        ctx.rateLimiter.checkLimit('read');
        const databases = await ctx.metabaseClient.getDatabases();
        ctx.auditLogger.logSuccess('list_databases', { count: databases.length });

        return createTextResponse({
          count: databases.length,
          databases: databases.map(d => ({
            id: d.id,
            name: d.name,
            description: d.description,
            engine: d.engine,
            is_sample: d.is_sample,
          })),
        });
      } catch (error) {
        ctx.auditLogger.logFailure('list_databases', error as Error);
        return createErrorResponse(error as Error);
      }
    }
  );

  // ============================================================================
  // get_database_schema
  // ============================================================================
  server.tool(
    'get_database_schema',
    'Get tables and columns for a database',
    {
      database_id: z.number().describe('Database ID'),
      detail: z.enum(['full', 'tables_only']).optional().describe('Level of detail. "tables_only" returns table names without columns'),
      format: z.enum(['default', 'compact']).optional().describe('Response format. "compact" reduces token usage'),
      tables: z.array(z.string()).optional().describe('Filter to specific table names'),
    },
    { title: 'Get Database Schema', readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    async ({ database_id, detail, format, tables }) => {
      try {
        ctx.rateLimiter.checkLimit('read');
        const schema = await ctx.schemaManager.getSchema(database_id);
        ctx.auditLogger.logSuccess('get_database_schema', {
          database_id,
          tableCount: schema.tables.length,
        });

        const formatted = formatSchemaResult(schema, { detail, format, tables });
        return format === 'compact'
          ? createCompactTextResponse(formatted)
          : createTextResponse(formatted);
      } catch (error) {
        ctx.auditLogger.logFailure('get_database_schema', error as Error, { database_id });
        return createErrorResponse(error as Error);
      }
    }
  );

  // ============================================================================
  // execute_query
  // ============================================================================
  server.tool(
    'execute_query',
    'Execute a SQL query (SELECT statements only)',
    {
      database_id: z.number().describe('Database ID to query'),
      sql: z.string().describe('SQL query (SELECT statements only)'),
      fields: z.array(z.string()).optional().describe('Column names to include in results (default: all)'),
      format: z.enum(['default', 'compact']).optional().describe('Response format. "compact" reduces token usage by ~50%'),
      limit: z.number().min(1).max(10000).optional().describe('Max rows to return (default: server maxRows setting)'),
      offset: z.number().min(0).optional().describe('Row offset for pagination'),
    },
    { title: 'Execute SQL Query', readOnlyHint: true, openWorldHint: true },
    async ({ database_id, sql, fields, format, limit, offset }) => {
      try {
        ctx.rateLimiter.checkLimit('read');

        // Validate SQL
        const validation = ctx.sqlGuardrails.validate(sql);
        if (!validation.valid) {
          ctx.auditLogger.logBlocked('execute_query', validation.errors.join(', '), {
            database_id,
            sql: sql.substring(0, 200),
          });
          throw new SQLValidationError(
            'SQL validation failed',
            validation.errors,
            validation.warnings
          );
        }

        // Execute query
        const startTime = Date.now();
        const result = await ctx.metabaseClient.executeQuery(database_id, validation.sanitizedSQL);
        const duration = Date.now() - startTime;

        ctx.auditLogger.logQuery(database_id, validation.sanitizedSQL, result.row_count, duration);

        // Format response
        const formatted = formatQueryResult(
          result.data.cols,
          result.data.rows,
          result.row_count,
          {
            fields,
            format,
            limit: limit ?? ctx.config.metabase.maxRows,
            offset: offset ?? 0,
          }
        );

        const response = {
          ...formatted,
          execution_time_ms: duration,
          warnings: validation.warnings,
        };

        return format === 'compact'
          ? createCompactTextResponse(response)
          : createTextResponse(response);
      } catch (error) {
        if (error instanceof SQLValidationError) {
          return createErrorResponse(error);
        }
        ctx.auditLogger.logFailure('execute_query', error as Error, { database_id });
        return createErrorResponse(error as Error);
      }
    }
  );

  // ============================================================================
  // search_content
  // ============================================================================
  server.tool(
    'search_content',
    'Search across Metabase content (dashboards, cards, collections)',
    {
      query: z.string().describe('Search query'),
      type: z.enum(['card', 'dashboard', 'collection', 'database', 'table']).optional()
        .describe('Filter by content type'),
    },
    { title: 'Search Content', readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    async ({ query, type }) => {
      try {
        ctx.rateLimiter.checkLimit('read');
        const results = await ctx.metabaseClient.search(query, type ? [type] : undefined);
        ctx.auditLogger.logSuccess('search_content', {
          query,
          type,
          resultCount: results.length,
        });

        return createTextResponse({
          count: results.length,
          results: results.map(r => ({
            id: r.id,
            name: r.name,
            description: r.description,
            model: r.model,
            collection_id: r.collection_id,
            collection_name: r.collection_name,
          })),
        });
      } catch (error) {
        ctx.auditLogger.logFailure('search_content', error as Error, { query, type });
        return createErrorResponse(error as Error);
      }
    }
  );

  // ============================================================================
  // get_collections
  // ============================================================================
  server.tool(
    'get_collections',
    'List all collections',
    {},
    { title: 'Get Collections', readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    async () => {
      try {
        ctx.rateLimiter.checkLimit('read');
        const collections = await ctx.metabaseClient.getCollections();
        ctx.auditLogger.logSuccess('get_collections', { count: collections.length });

        return createTextResponse({
          count: collections.length,
          collections: collections.map(c => ({
            id: c.id,
            name: c.name,
            description: c.description,
            color: c.color,
            location: c.location,
            archived: c.archived,
          })),
        });
      } catch (error) {
        ctx.auditLogger.logFailure('get_collections', error as Error);
        return createErrorResponse(error as Error);
      }
    }
  );
}
