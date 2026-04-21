# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build and Development Commands

```bash
# Install dependencies
npm install

# Build the project (TypeScript to JavaScript)
npm run build

# Watch mode for development
npm run dev

# Start the MCP server
npm start

# Type checking without emitting
npm run type-check

# Linting
npm run lint
```

## Testing Commands

```bash
# Run all tests
npm test

# Run only unit tests
npm run test:unit

# Run only integration tests
npm run test:integration

# Run tests in watch mode
npm run test:watch

# Run a single test file
npx vitest run tests/unit/security/sql-guardrails.test.ts

# Run tests matching a pattern
npx vitest run -t "validates SELECT"
```

## Architecture Overview

This is an MCP (Model Context Protocol) server that connects Claude to Metabase for natural language data analysis.

### Entry Point and Flow

1. **src/index.ts** - Entry point that initializes all components and starts the MCP server
2. **src/config.ts** - Zod-validated configuration loading from environment variables
3. **src/tools/index.ts** - Tool registration based on server mode (read/write/full)

### Authentication

API key authentication via `METABASE_API_KEY`. The key is passed as `X-API-Key` header to all Metabase API requests through `MetabaseClient`.

### Core Components

- **src/client/metabase-client.ts** - Metabase REST API wrapper with all CRUD operations
- **src/client/types.ts** - Metabase API types and config interfaces
- **src/client/llm-service.ts** - Anthropic Claude API integration with token budgeting (daily/monthly limits)

### Tool Categories (30 total tools)

| Category | File | Tools | Description |
|----------|------|-------|-------------|
| Read-Only | `src/tools/read-tools.ts` | 10 | Dashboard, card, database, collection queries |
| Batch | `src/tools/batch-tools.ts` | 1 | Parallel execution of multiple read operations |
| Workflow | `src/tools/workflow-tools.ts` | 1 | Composable multi-step pipelines with output chaining |
| DML/Write | `src/tools/write-tools.ts` | 10 | Create/update/delete cards, dashboards, collections |
| NLQ | `src/tools/nlq-tools.ts` | 4 | Natural language to SQL conversion |
| Insights | `src/tools/insight-tools.ts` | 4 | Automated data analysis and trends |

- **src/tools/types.ts** - `ToolContext` interface shared across tool modules

### Security Layer

- **src/security/sql-guardrails.ts** - SQL validation, injection detection, blocked pattern enforcement
- **src/security/rate-limiter.ts** - Tiered rate limiting (read: 60/min, write: 30/min, llm: 20/min)
- **src/security/audit-logger.ts** - Operation logging with risk assessment

### Utilities

- **src/utils/schema-manager.ts** - Database schema caching with TTL
- **src/utils/errors.ts** - Custom error classes (MetabaseError, SQLValidationError, etc.)

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `METABASE_URL` | Yes | - | Metabase instance URL |
| `METABASE_API_KEY` | Yes | - | Metabase API key |
| `MCP_MODE` | No | `read` | Server mode: `read`, `write`, or `full` |
| `ANTHROPIC_API_KEY` | For NLQ/insights | - | Enables NLQ and insight tools |

## Server Modes

The `MCP_MODE` environment variable controls which tools are available:

- **read** - 12 tools (10 read-only + batch + workflow) + NLQ (if Anthropic key set)
- **write** - 22 tools (read + batch + workflow + DML) + NLQ
- **full** - All 30 tools including insights

## Test Structure

```
tests/
├── setup.ts                          # Global test setup
├── fixtures/index.ts                 # Shared test fixtures
├── unit/
│   ├── config.test.ts                # Config loading/validation
│   ├── security/
│   │   ├── sql-guardrails.test.ts    # SQL validation
│   │   └── rate-limiter.test.ts      # Rate limiting
│   └── utils/
│       ├── schema-manager.test.ts
│       └── errors.test.ts
└── integration/
    ├── read-tools.test.ts
    ├── write-tools.test.ts
    ├── batch-tools.test.ts
    ├── workflow-tools.test.ts
    └── nlq-tools.test.ts
```

Note: `vi.hoisted()` is needed for mock variables used in `vi.mock()` factory functions.

## Key Patterns

### Tool Registration Pattern

Tools are registered using the MCP SDK's `server.tool()` method with Zod schemas for input validation:

```typescript
server.tool(
  'tool_name',
  'Tool description',
  { param: z.string().describe('Parameter description') },
  async ({ param }) => { /* handler */ }
);
```

### Response Pattern

All tools return responses via helper functions:

```typescript
createTextResponse(data)   // Success responses
createErrorResponse(error) // Error responses
```

### Security Validation

All SQL queries go through the guardrails before execution:

```typescript
const validation = ctx.sqlGuardrails.validate(sql);
if (!validation.valid) {
  throw new SQLValidationError('SQL validation failed', validation.errors);
}
// Use validation.sanitizedSQL for execution
```

## Git Workflow

**Always use branch and PR process to make changes. Never merge to main directly.**

### Required Process

1. Create a feature branch from `main`:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. Make your changes and commit to the feature branch

3. Push the branch to GitHub:
   ```bash
   git push -u origin feature/your-feature-name
   ```

4. Create a Pull Request for review

5. After approval, merge via the PR (not directly to main)

### Branch Naming Conventions

- `feature/` - New features
- `fix/` - Bug fixes
- `docs/` - Documentation updates
- `refactor/` - Code refactoring
- `test/` - Test additions or updates

### Commit Messages

- Use clear, descriptive commit messages
- Start with a verb (Add, Fix, Update, Remove, Refactor)
- Reference issue numbers when applicable
