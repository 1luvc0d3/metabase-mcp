/**
 * Write Tools (DML)
 * Tools for creating, updating, and deleting Metabase objects
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ToolContext } from './types.js';
import { createTextResponse, createErrorResponse } from './types.js';
import { SQLValidationError } from '../utils/errors.js';

export function registerWriteTools(server: McpServer, ctx: ToolContext): void {
  // ============================================================================
  // create_card
  // ============================================================================
  server.tool(
    'create_card',
    'Create a new question/card in Metabase',
    {
      name: z.string().describe('Card name'),
      database_id: z.number().describe('Database ID'),
      sql: z.string().describe('SQL query for the card'),
      collection_id: z.number().optional().describe('Collection to save the card to'),
      description: z.string().optional().describe('Card description'),
      display: z.enum(['table', 'bar', 'line', 'pie', 'scalar', 'row', 'area', 'combo', 'pivot', 'smartscalar', 'progress', 'funnel', 'waterfall', 'map'])
        .default('table').describe('Visualization type'),
    },
    { title: 'Create Card', destructiveHint: false, openWorldHint: true },
    async ({ name, database_id, sql, collection_id, description, display }) => {
      try {
        ctx.rateLimiter.checkLimit('write');

        // Validate SQL
        const validation = ctx.sqlGuardrails.validate(sql);
        if (!validation.valid) {
          ctx.auditLogger.logBlocked('create_card', validation.errors.join(', '), { name });
          throw new SQLValidationError('SQL validation failed', validation.errors, validation.warnings);
        }

        const card = await ctx.metabaseClient.createCard({
          name,
          dataset_query: {
            type: 'native',
            database: database_id,
            native: { query: validation.sanitizedSQL },
          },
          display,
          visualization_settings: {},
          collection_id,
          description,
        });

        ctx.auditLogger.logSuccess('create_card', { card_id: card.id, name });

        return createTextResponse({
          success: true,
          card: {
            id: card.id,
            name: card.name,
            description: card.description,
            display: card.display,
            collection_id: card.collection_id,
          },
        });
      } catch (error) {
        ctx.auditLogger.logFailure('create_card', error as Error, { name });
        return createErrorResponse(error as Error);
      }
    }
  );

  // ============================================================================
  // update_card
  // ============================================================================
  server.tool(
    'update_card',
    'Update an existing question/card',
    {
      card_id: z.number().describe('Card ID to update'),
      name: z.string().optional().describe('New card name'),
      description: z.string().optional().describe('New description'),
      sql: z.string().optional().describe('New SQL query'),
      collection_id: z.number().optional().describe('Move to collection'),
      display: z.string().optional().describe('Change visualization type'),
    },
    { title: 'Update Card', destructiveHint: true, openWorldHint: true },
    async ({ card_id, name, description, sql, collection_id, display }) => {
      try {
        ctx.rateLimiter.checkLimit('write');

        const updates: Record<string, unknown> = {};

        if (name !== undefined) updates.name = name;
        if (description !== undefined) updates.description = description;
        if (collection_id !== undefined) updates.collection_id = collection_id;
        if (display !== undefined) updates.display = display;

        if (sql !== undefined) {
          const validation = ctx.sqlGuardrails.validate(sql);
          if (!validation.valid) {
            ctx.auditLogger.logBlocked('update_card', validation.errors.join(', '), { card_id });
            throw new SQLValidationError('SQL validation failed', validation.errors, validation.warnings);
          }

          // Get current card to preserve database_id
          const currentCard = await ctx.metabaseClient.getCard(card_id);
          updates.dataset_query = {
            type: 'native',
            database: currentCard.database_id,
            native: { query: validation.sanitizedSQL },
          };
        }

        const card = await ctx.metabaseClient.updateCard(card_id, updates);
        ctx.auditLogger.logSuccess('update_card', { card_id, updates: Object.keys(updates) });

        return createTextResponse({
          success: true,
          card: {
            id: card.id,
            name: card.name,
            description: card.description,
            display: card.display,
          },
        });
      } catch (error) {
        ctx.auditLogger.logFailure('update_card', error as Error, { card_id });
        return createErrorResponse(error as Error);
      }
    }
  );

  // ============================================================================
  // delete_card
  // ============================================================================
  server.tool(
    'delete_card',
    'Delete (archive) a question/card',
    {
      card_id: z.number().describe('Card ID to delete'),
    },
    { title: 'Delete Card', destructiveHint: true, openWorldHint: true },
    async ({ card_id }) => {
      try {
        ctx.rateLimiter.checkLimit('write');
        await ctx.metabaseClient.deleteCard(card_id);
        ctx.auditLogger.logSuccess('delete_card', { card_id });

        return createTextResponse({
          success: true,
          message: `Card ${card_id} has been archived`,
        });
      } catch (error) {
        ctx.auditLogger.logFailure('delete_card', error as Error, { card_id });
        return createErrorResponse(error as Error);
      }
    }
  );

  // ============================================================================
  // create_dashboard
  // ============================================================================
  server.tool(
    'create_dashboard',
    'Create a new dashboard',
    {
      name: z.string().describe('Dashboard name'),
      description: z.string().optional().describe('Dashboard description'),
      collection_id: z.number().optional().describe('Collection to save to'),
    },
    { title: 'Create Dashboard', destructiveHint: false, openWorldHint: true },
    async ({ name, description, collection_id }) => {
      try {
        ctx.rateLimiter.checkLimit('write');

        const dashboard = await ctx.metabaseClient.createDashboard({
          name,
          description,
          collection_id,
        });

        ctx.auditLogger.logSuccess('create_dashboard', { dashboard_id: dashboard.id, name });

        return createTextResponse({
          success: true,
          dashboard: {
            id: dashboard.id,
            name: dashboard.name,
            description: dashboard.description,
            collection_id: dashboard.collection_id,
          },
        });
      } catch (error) {
        ctx.auditLogger.logFailure('create_dashboard', error as Error, { name });
        return createErrorResponse(error as Error);
      }
    }
  );

  // ============================================================================
  // update_dashboard
  // ============================================================================
  server.tool(
    'update_dashboard',
    'Update an existing dashboard',
    {
      dashboard_id: z.number().describe('Dashboard ID to update'),
      name: z.string().optional().describe('New dashboard name'),
      description: z.string().optional().describe('New description'),
      collection_id: z.number().optional().describe('Move to collection'),
    },
    { title: 'Update Dashboard', destructiveHint: true, openWorldHint: true },
    async ({ dashboard_id, name, description, collection_id }) => {
      try {
        ctx.rateLimiter.checkLimit('write');

        const updates: Record<string, unknown> = {};
        if (name !== undefined) updates.name = name;
        if (description !== undefined) updates.description = description;
        if (collection_id !== undefined) updates.collection_id = collection_id;

        const dashboard = await ctx.metabaseClient.updateDashboard(dashboard_id, updates);
        ctx.auditLogger.logSuccess('update_dashboard', { dashboard_id, updates: Object.keys(updates) });

        return createTextResponse({
          success: true,
          dashboard: {
            id: dashboard.id,
            name: dashboard.name,
            description: dashboard.description,
          },
        });
      } catch (error) {
        ctx.auditLogger.logFailure('update_dashboard', error as Error, { dashboard_id });
        return createErrorResponse(error as Error);
      }
    }
  );

  // ============================================================================
  // delete_dashboard
  // ============================================================================
  server.tool(
    'delete_dashboard',
    'Delete (archive) a dashboard',
    {
      dashboard_id: z.number().describe('Dashboard ID to delete'),
    },
    { title: 'Delete Dashboard', destructiveHint: true, openWorldHint: true },
    async ({ dashboard_id }) => {
      try {
        ctx.rateLimiter.checkLimit('write');
        await ctx.metabaseClient.deleteDashboard(dashboard_id);
        ctx.auditLogger.logSuccess('delete_dashboard', { dashboard_id });

        return createTextResponse({
          success: true,
          message: `Dashboard ${dashboard_id} has been archived`,
        });
      } catch (error) {
        ctx.auditLogger.logFailure('delete_dashboard', error as Error, { dashboard_id });
        return createErrorResponse(error as Error);
      }
    }
  );

  // ============================================================================
  // add_card_to_dashboard
  // ============================================================================
  server.tool(
    'add_card_to_dashboard',
    'Add a card/question to a dashboard',
    {
      dashboard_id: z.number().describe('Dashboard ID'),
      card_id: z.number().describe('Card ID to add'),
      row: z.number().optional().default(0).describe('Row position'),
      col: z.number().optional().default(0).describe('Column position'),
      size_x: z.number().optional().default(4).describe('Width (in grid units)'),
      size_y: z.number().optional().default(4).describe('Height (in grid units)'),
    },
    { title: 'Add Card to Dashboard', destructiveHint: false, openWorldHint: true },
    async ({ dashboard_id, card_id, row, col, size_x, size_y }) => {
      try {
        ctx.rateLimiter.checkLimit('write');

        await ctx.metabaseClient.addCardToDashboard(dashboard_id, card_id, {
          row: row ?? 0,
          col: col ?? 0,
          size_x: size_x ?? 4,
          size_y: size_y ?? 4,
        });

        ctx.auditLogger.logSuccess('add_card_to_dashboard', { dashboard_id, card_id });

        return createTextResponse({
          success: true,
          message: `Card ${card_id} added to dashboard ${dashboard_id}`,
        });
      } catch (error) {
        ctx.auditLogger.logFailure('add_card_to_dashboard', error as Error, { dashboard_id, card_id });
        return createErrorResponse(error as Error);
      }
    }
  );

  // ============================================================================
  // remove_card_from_dashboard
  // ============================================================================
  server.tool(
    'remove_card_from_dashboard',
    'Remove a card from a dashboard',
    {
      dashboard_id: z.number().describe('Dashboard ID'),
      dashcard_id: z.number().describe('Dashboard card ID (not the card ID)'),
    },
    { title: 'Remove Card from Dashboard', destructiveHint: true, openWorldHint: true },
    async ({ dashboard_id, dashcard_id }) => {
      try {
        ctx.rateLimiter.checkLimit('write');
        await ctx.metabaseClient.removeCardFromDashboard(dashboard_id, dashcard_id);
        ctx.auditLogger.logSuccess('remove_card_from_dashboard', { dashboard_id, dashcard_id });

        return createTextResponse({
          success: true,
          message: `Card removed from dashboard ${dashboard_id}`,
        });
      } catch (error) {
        ctx.auditLogger.logFailure('remove_card_from_dashboard', error as Error, { dashboard_id, dashcard_id });
        return createErrorResponse(error as Error);
      }
    }
  );

  // ============================================================================
  // create_collection
  // ============================================================================
  server.tool(
    'create_collection',
    'Create a new collection',
    {
      name: z.string().describe('Collection name'),
      description: z.string().optional().describe('Collection description'),
      color: z.string().optional().describe('Collection color (hex code)'),
      parent_id: z.number().optional().describe('Parent collection ID'),
    },
    { title: 'Create Collection', destructiveHint: false, openWorldHint: true },
    async ({ name, description, color, parent_id }) => {
      try {
        ctx.rateLimiter.checkLimit('write');

        const collection = await ctx.metabaseClient.createCollection({
          name,
          description,
          color,
          parent_id,
        });

        ctx.auditLogger.logSuccess('create_collection', { collection_id: collection.id, name });

        return createTextResponse({
          success: true,
          collection: {
            id: collection.id,
            name: collection.name,
            description: collection.description,
            color: collection.color,
          },
        });
      } catch (error) {
        ctx.auditLogger.logFailure('create_collection', error as Error, { name });
        return createErrorResponse(error as Error);
      }
    }
  );

  // ============================================================================
  // move_to_collection
  // ============================================================================
  server.tool(
    'move_to_collection',
    'Move a card or dashboard to a different collection',
    {
      item_type: z.enum(['card', 'dashboard']).describe('Type of item to move'),
      item_id: z.number().describe('ID of the item to move'),
      collection_id: z.number().describe('Target collection ID'),
    },
    { title: 'Move to Collection', destructiveHint: true, openWorldHint: true },
    async ({ item_type, item_id, collection_id }) => {
      try {
        ctx.rateLimiter.checkLimit('write');

        if (item_type === 'card') {
          await ctx.metabaseClient.updateCard(item_id, { collection_id });
        } else {
          await ctx.metabaseClient.updateDashboard(item_id, { collection_id });
        }

        ctx.auditLogger.logSuccess('move_to_collection', { item_type, item_id, collection_id });

        return createTextResponse({
          success: true,
          message: `${item_type} ${item_id} moved to collection ${collection_id}`,
        });
      } catch (error) {
        ctx.auditLogger.logFailure('move_to_collection', error as Error, { item_type, item_id, collection_id });
        return createErrorResponse(error as Error);
      }
    }
  );
}
