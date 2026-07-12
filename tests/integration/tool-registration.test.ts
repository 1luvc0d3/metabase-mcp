/**
 * Tool Registration Integration Tests
 * Verifies mode-based registration and per-tool access gating
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerTools } from '../../src/tools/index.js';
import { createToolGate } from '../../src/security/tool-gate.js';
import type { ToolContext } from '../../src/tools/types.js';
import { SQLGuardrails } from '../../src/security/sql-guardrails.js';
import { TieredRateLimiter } from '../../src/security/rate-limiter.js';
import { AuditLogger } from '../../src/security/audit-logger.js';
import { SchemaManager } from '../../src/utils/schema-manager.js';
import { Logger } from '../../src/config.js';
import { createMockMetabaseClient, createTestConfig } from '../setup.js';

describe('Tool Registration', () => {
  let server: McpServer;
  let registeredNames: string[];
  let context: ToolContext;

  beforeEach(() => {
    server = new McpServer({ name: 'test', version: '1.0.0' });
    registeredNames = [];

    const originalTool = server.tool.bind(server);
    vi.spyOn(server, 'tool').mockImplementation((name: string, ...args: any[]) => {
      registeredNames.push(name);
      return originalTool(name, ...args);
    });

    const config = createTestConfig();
    const mockClient = createMockMetabaseClient();

    context = {
      config: { mode: 'read', metabase: { maxRows: 10000 } },
      metabaseClient: mockClient as any,
      llmService: null,
      sqlGuardrails: new SQLGuardrails(config.security),
      rateLimiter: new TieredRateLimiter(),
      auditLogger: new AuditLogger(),
      schemaManager: new SchemaManager(mockClient as any),
      logger: new Logger('error'),
    };
  });

  it('registers all read/batch/workflow tools without a gate', async () => {
    await registerTools(server, context);

    expect(registeredNames).toContain('list_dashboards');
    expect(registeredNames).toContain('execute_query');
    expect(registeredNames).toContain('batch_execute');
    expect(registeredNames).toContain('run_workflow');
    expect(registeredNames).toHaveLength(12);
  });

  it('skips tools on the deny list', async () => {
    context.toolGate = createToolGate(undefined, ['execute_query', 'batch_execute']);

    await registerTools(server, context);

    expect(registeredNames).not.toContain('execute_query');
    expect(registeredNames).not.toContain('batch_execute');
    expect(registeredNames).toContain('list_dashboards');
    expect(registeredNames).toHaveLength(10);
  });

  it('registers only allow-listed tools', async () => {
    context.toolGate = createToolGate(['list_dashboards', 'get_dashboard']);

    await registerTools(server, context);

    expect(registeredNames).toEqual(
      expect.arrayContaining(['list_dashboards', 'get_dashboard'])
    );
    expect(registeredNames).toHaveLength(2);
  });

  it('gates write tools in write mode', async () => {
    context.config = { mode: 'write', metabase: { maxRows: 10000 } };
    context.toolGate = createToolGate(undefined, ['delete_card', 'delete_dashboard']);

    await registerTools(server, context);

    expect(registeredNames).toContain('create_card');
    expect(registeredNames).not.toContain('delete_card');
    expect(registeredNames).not.toContain('delete_dashboard');
  });
});
