#!/usr/bin/env node
/**
 * Metabase MCP Server
 * Entry point - initializes the MCP server with configured tools
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig, Logger } from './config.js';
import { MetabaseClient } from './client/metabase-client.js';
import { LLMService } from './client/llm-service.js';
import { SQLGuardrails } from './security/sql-guardrails.js';
import { TieredRateLimiter } from './security/rate-limiter.js';
import { AuditLogger } from './security/audit-logger.js';
import { SchemaManager } from './utils/schema-manager.js';
import { registerTools } from './tools/index.js';
import type { ToolContext } from './tools/types.js';

async function main() {
  // Load and validate configuration
  const config = loadConfig();
  const logger = new Logger(config.logging.level);

  logger.info('Starting Metabase MCP Server', {
    mode: config.mode,
    metabaseUrl: config.metabase.url,
    nlqEnabled: !!config.anthropicApiKey,
  });

  // Initialize MCP server
  const server = new McpServer({
    name: 'metabase-mcp',
    version: '1.0.0',
  });

  // Initialize core services
  const metabaseClient = new MetabaseClient(config.metabase);
  const sqlGuardrails = new SQLGuardrails(config.security);
  const rateLimiter = new TieredRateLimiter();
  const auditLogger = new AuditLogger({ logFile: config.logging.auditFile });
  const schemaManager = new SchemaManager(metabaseClient);

  // Initialize LLM service if API key is provided
  let llmService: LLMService | null = null;
  if (config.anthropicApiKey) {
    llmService = new LLMService(config.anthropicApiKey, config.llm, auditLogger);
    logger.info('LLM service initialized - NLQ features enabled');
  } else {
    logger.warn('ANTHROPIC_API_KEY not set - NLQ features disabled');
  }

  // Create tool context — expose only safe config subset (no API keys)
  const toolContext: ToolContext = {
    config: {
      mode: config.mode,
      metabase: { maxRows: config.metabase.maxRows },
    },
    metabaseClient,
    llmService,
    sqlGuardrails,
    rateLimiter,
    auditLogger,
    schemaManager,
    logger,
  };

  // Register tools based on mode
  await registerTools(server, toolContext);

  // Connect via stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  logger.info('MCP Server connected and ready');
}

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error('[FATAL] Uncaught exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] Unhandled rejection:', reason);
  process.exit(1);
});

// Start the server
main().catch((error) => {
  console.error('[FATAL] Failed to start MCP server:', error);
  process.exit(1);
});
