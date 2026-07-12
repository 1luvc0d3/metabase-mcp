/**
 * Tool Registration
 * Registers MCP tools based on server mode
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolContext } from './types.js';
import type { ToolGate } from '../security/tool-gate.js';
import { registerReadTools } from './read-tools.js';
import { registerWriteTools } from './write-tools.js';
import { registerNLQTools } from './nlq-tools.js';
import { registerInsightTools } from './insight-tools.js';
import { registerBatchTools } from './batch-tools.js';
import { registerWorkflowTools } from './workflow-tools.js';

/**
 * Wrap a server so that server.tool() calls for gated-out names are
 * silently skipped instead of registered.
 */
function createGatedServer(
  server: McpServer,
  gate: ToolGate,
  onSkip: (name: string) => void
): McpServer {
  const gated = Object.create(server) as McpServer;
  Object.defineProperty(gated, 'tool', {
    value: (name: string, ...rest: unknown[]) => {
      if (!gate(name)) {
        onSkip(name);
        return undefined;
      }
      return (server.tool as unknown as (...toolArgs: unknown[]) => unknown).call(
        server,
        name,
        ...rest
      );
    },
  });
  return gated;
}

export async function registerTools(
  server: McpServer,
  context: ToolContext
): Promise<void> {
  const { config, logger } = context;

  const skipped: string[] = [];
  const target = context.toolGate
    ? createGatedServer(server, context.toolGate, name => skipped.push(name))
    : server;

  // Always register read tools, batch tools, and workflow tools
  registerReadTools(target, context);
  registerBatchTools(target, context);
  registerWorkflowTools(target, context);
  logger.info('Registered read-only tools');
  logger.info('Registered batch and workflow tools');

  // Register write tools if mode allows
  if (config.mode === 'write' || config.mode === 'full') {
    registerWriteTools(target, context);
    logger.info('Registered write tools');
  }

  // Register NLQ tools if LLM service is available
  if (context.llmService) {
    registerNLQTools(target, context);
    logger.info('Registered NLQ-to-SQL tools');

    // Register insight tools only in full mode
    if (config.mode === 'full') {
      registerInsightTools(target, context);
      logger.info('Registered insight tools');
    }
  }

  // Log summary
  const toolCounts = {
    read: 10,
    batch: 1,
    workflow: 1,
    write: config.mode === 'write' || config.mode === 'full' ? 10 : 0,
    nlq: context.llmService ? 4 : 0,
    insight: config.mode === 'full' && context.llmService ? 4 : 0,
  };

  const totalTools = Object.values(toolCounts).reduce((a, b) => a + b, 0) - skipped.length;
  logger.info(`Total tools registered: ${totalTools}`, toolCounts);
  if (skipped.length > 0) {
    logger.info(`Tools disabled by access policy: ${skipped.join(', ')}`);
  }
}
