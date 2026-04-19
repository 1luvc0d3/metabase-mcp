import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { Logger } from '../config.js';

export async function startStdioTransport(
  server: McpServer,
  logger: Logger
): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info('MCP Server connected via stdio transport');
}
