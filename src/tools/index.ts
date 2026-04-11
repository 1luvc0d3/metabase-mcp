/**
 * Tool Registration
 * Registers MCP tools based on server mode
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolContext } from './types.js';
import { registerReadTools } from './read-tools.js';
import { registerWriteTools } from './write-tools.js';
import { registerNLQTools } from './nlq-tools.js';
import { registerInsightTools } from './insight-tools.js';

export async function registerTools(
  server: McpServer,
  context: ToolContext
): Promise<void> {
  const { config, logger } = context;

  // Always register read tools
  registerReadTools(server, context);
  logger.info('Registered read-only tools');

  // Register write tools if mode allows
  if (config.mode === 'write' || config.mode === 'full') {
    registerWriteTools(server, context);
    logger.info('Registered write tools');
  }

  // Register NLQ tools if LLM service is available
  if (context.llmService) {
    registerNLQTools(server, context);
    logger.info('Registered NLQ-to-SQL tools');

    // Register insight tools only in full mode
    if (config.mode === 'full') {
      registerInsightTools(server, context);
      logger.info('Registered insight tools');
    }
  }

  // Log summary
  const toolCounts = {
    read: 10,
    write: config.mode === 'write' || config.mode === 'full' ? 10 : 0,
    nlq: context.llmService ? 4 : 0,
    insight: config.mode === 'full' && context.llmService ? 4 : 0,
  };

  const totalTools = Object.values(toolCounts).reduce((a, b) => a + b, 0);
  logger.info(`Total tools registered: ${totalTools}`, toolCounts);
}
