/**
 * Batchable Write Operations
 * Non-destructive write operations shared by batch_execute and run_workflow.
 * Destructive operations (delete_card, delete_dashboard,
 * remove_card_from_dashboard) are intentionally excluded — they must be
 * explicit single tool calls.
 */

import { z } from 'zod';
import type { ToolContext } from './types.js';
import { SQLValidationError } from '../utils/errors.js';

export const BATCHABLE_WRITE_TOOLS = [
  'create_card',
  'update_card',
  'create_dashboard',
  'update_dashboard',
  'add_card_to_dashboard',
  'create_collection',
  'move_to_collection',
] as const;

export type BatchableWriteTool = (typeof BATCHABLE_WRITE_TOOLS)[number];

export function isBatchableWriteTool(tool: string): tool is BatchableWriteTool {
  return (BATCHABLE_WRITE_TOOLS as readonly string[]).includes(tool);
}

export function isWriteModeEnabled(ctx: ToolContext): boolean {
  return ctx.config.mode === 'write' || ctx.config.mode === 'full';
}

/** Zod schemas for batch_execute's discriminated union */
export const writeOperationSchemas = [
  z.object({
    tool: z.literal('create_card'),
    args: z.object({
      name: z.string(),
      database_id: z.number(),
      sql: z.string(),
      collection_id: z.number().optional(),
      description: z.string().optional(),
      display: z.string().optional(),
    }),
  }),
  z.object({
    tool: z.literal('update_card'),
    args: z.object({
      card_id: z.number(),
      name: z.string().optional(),
      description: z.string().optional(),
      sql: z.string().optional(),
      collection_id: z.number().optional(),
      display: z.string().optional(),
    }),
  }),
  z.object({
    tool: z.literal('create_dashboard'),
    args: z.object({
      name: z.string(),
      description: z.string().optional(),
      collection_id: z.number().optional(),
    }),
  }),
  z.object({
    tool: z.literal('update_dashboard'),
    args: z.object({
      dashboard_id: z.number(),
      name: z.string().optional(),
      description: z.string().optional(),
      collection_id: z.number().optional(),
    }),
  }),
  z.object({
    tool: z.literal('add_card_to_dashboard'),
    args: z.object({
      dashboard_id: z.number(),
      card_id: z.number(),
      row: z.number().optional(),
      col: z.number().optional(),
      size_x: z.number().optional(),
      size_y: z.number().optional(),
    }),
  }),
  z.object({
    tool: z.literal('create_collection'),
    args: z.object({
      name: z.string(),
      description: z.string().optional(),
      color: z.string().optional(),
      parent_id: z.number().optional(),
    }),
  }),
  z.object({
    tool: z.literal('move_to_collection'),
    args: z.object({
      item_type: z.enum(['card', 'dashboard']),
      item_id: z.number(),
      collection_id: z.number(),
    }),
  }),
];

/**
 * Execute one non-destructive write operation with the same guardrails as
 * the standalone write tools: write-tier rate limit, SQL validation, and
 * per-operation audit logging. Returns a flat result object so workflow
 * steps can reference fields like "$step.id".
 * @throws on rate limit, validation, or Metabase API errors
 */
export async function executeWriteOperation(
  tool: BatchableWriteTool,
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<unknown> {
  ctx.rateLimiter.checkLimit('write');

  try {
    const result = await performWrite(tool, args, ctx);
    ctx.auditLogger.logSuccess(tool, { via: 'batch_or_workflow', ...auditDetails(tool, args) });
    return result;
  } catch (error) {
    if (error instanceof SQLValidationError) {
      ctx.auditLogger.logBlocked(tool, error.message, auditDetails(tool, args));
    } else {
      ctx.auditLogger.logFailure(tool, error as Error, auditDetails(tool, args));
    }
    throw error;
  }
}

function auditDetails(tool: BatchableWriteTool, args: Record<string, unknown>): Record<string, unknown> {
  switch (tool) {
    case 'create_card':
    case 'create_dashboard':
    case 'create_collection':
      return { name: args.name };
    case 'update_card':
      return { card_id: args.card_id };
    case 'update_dashboard':
      return { dashboard_id: args.dashboard_id };
    case 'add_card_to_dashboard':
      return { dashboard_id: args.dashboard_id, card_id: args.card_id };
    case 'move_to_collection':
      return { item_type: args.item_type, item_id: args.item_id, collection_id: args.collection_id };
  }
}

function validateSQL(ctx: ToolContext, sql: string): string {
  const validation = ctx.sqlGuardrails.validate(sql);
  if (!validation.valid) {
    throw new SQLValidationError('SQL validation failed', validation.errors, validation.warnings);
  }
  return validation.sanitizedSQL;
}

async function performWrite(
  tool: BatchableWriteTool,
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<unknown> {
  switch (tool) {
    case 'create_card': {
      const sanitizedSQL = validateSQL(ctx, args.sql as string);
      const card = await ctx.metabaseClient.createCard({
        name: args.name as string,
        dataset_query: {
          type: 'native',
          database: args.database_id as number,
          native: { query: sanitizedSQL },
        },
        display: (args.display as string) ?? 'table',
        visualization_settings: {},
        collection_id: args.collection_id as number | undefined,
        description: args.description as string | undefined,
      });
      return { id: card.id, name: card.name, display: card.display, collection_id: card.collection_id };
    }
    case 'update_card': {
      const cardId = args.card_id as number;
      const updates: Record<string, unknown> = {};
      if (args.name !== undefined) updates.name = args.name;
      if (args.description !== undefined) updates.description = args.description;
      if (args.collection_id !== undefined) updates.collection_id = args.collection_id;
      if (args.display !== undefined) updates.display = args.display;
      if (args.sql !== undefined) {
        const sanitizedSQL = validateSQL(ctx, args.sql as string);
        const currentCard = await ctx.metabaseClient.getCard(cardId);
        updates.dataset_query = {
          type: 'native',
          database: currentCard.database_id,
          native: { query: sanitizedSQL },
        };
      }
      const card = await ctx.metabaseClient.updateCard(cardId, updates);
      return { id: card.id, name: card.name, display: card.display };
    }
    case 'create_dashboard': {
      const dashboard = await ctx.metabaseClient.createDashboard({
        name: args.name as string,
        description: args.description as string | undefined,
        collection_id: args.collection_id as number | undefined,
      });
      return { id: dashboard.id, name: dashboard.name, collection_id: dashboard.collection_id };
    }
    case 'update_dashboard': {
      const updates: Record<string, unknown> = {};
      if (args.name !== undefined) updates.name = args.name;
      if (args.description !== undefined) updates.description = args.description;
      if (args.collection_id !== undefined) updates.collection_id = args.collection_id;
      const dashboard = await ctx.metabaseClient.updateDashboard(args.dashboard_id as number, updates);
      return { id: dashboard.id, name: dashboard.name };
    }
    case 'add_card_to_dashboard': {
      await ctx.metabaseClient.addCardToDashboard(
        args.dashboard_id as number,
        args.card_id as number,
        {
          row: (args.row as number) ?? 0,
          col: (args.col as number) ?? 0,
          size_x: (args.size_x as number) ?? 4,
          size_y: (args.size_y as number) ?? 4,
        }
      );
      return { dashboard_id: args.dashboard_id, card_id: args.card_id, added: true };
    }
    case 'create_collection': {
      const collection = await ctx.metabaseClient.createCollection({
        name: args.name as string,
        description: args.description as string | undefined,
        color: args.color as string | undefined,
        parent_id: args.parent_id as number | undefined,
      });
      return { id: collection.id, name: collection.name };
    }
    case 'move_to_collection': {
      const itemId = args.item_id as number;
      const collectionId = args.collection_id as number;
      if (args.item_type === 'card') {
        await ctx.metabaseClient.updateCard(itemId, { collection_id: collectionId });
      } else {
        await ctx.metabaseClient.updateDashboard(itemId, { collection_id: collectionId });
      }
      return { item_type: args.item_type, item_id: itemId, collection_id: collectionId, moved: true };
    }
  }
}
