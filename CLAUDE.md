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
- **src/security/column-redactor.ts** - Masks/drops configured columns in query results; applied inside `MetabaseClient.executeCard`/`executeQuery`

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
| `MCP_REDACT_COLUMNS` | No | - | Column names to redact from query results (`*` wildcard) |
| `MCP_REDACT_MODE` | No | `mask` | `mask` or `drop` |
| `MCP_TRANSPORT` | No | `stdio` | `http` serves Streamable HTTP (`src/transport/http-transport.ts`) |
| `MCP_AUTH_TOKENS` | HTTP off-localhost | - | `name:token` pairs; per-user rate limits, audit `actor`, session ownership |
| `MCP_AUTH_MODE` | No | `shared` | `passthrough`: each request carries the caller's Metabase credential; no server-side key |

### Shared server (Docker)

`Dockerfile` + `docker-compose.yml` run the HTTP transport for a team (docs/docker.md). Shared mode: one Metabase API key, a bearer token per person. Passthrough mode: each request carries the caller's own Metabase credential, verified via `GET /api/user/current` when the session opens; `index.ts` passes a `createMetabaseClient` factory so per-user clients keep the column redactor, and each credential gets its own `SchemaManager`. Passthrough abuse controls: rejected credentials are cached (5 min) and answered 401 without Metabase, concurrent checks of one credential share a request, fresh rejections count against a per-IP budget (`MCP_AUTH_FAILURES_PER_MINUTE`, 429), and credentials verified in the last hour bypass it. Tests simulate client IPs with `trustProxy: true` + `X-Forwarded-For`. `createHttpApp()` builds the app without listening, so tests drive it with the SDK client on port 0 (needs local port binding, which the Claude Code sandbox blocks). CI builds the image and checks it refuses to start without tokens; releases push a multi-arch image to GHCR.

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

### End-to-end tests (real Metabase)

The unit and integration tests mock Metabase. `tests/e2e/` runs the built server through a real MCP client against a live instance (20 checks: queries, parameters, card and dashboard writes, batch, workflow, redaction, guardrails). `.github/workflows/nightly.yml` runs it every night against v0.50 (oldest supported), the current LTS and `latest`; failures open a `nightly-e2e` issue.

Run it locally against a throwaway container:

```bash
docker run -d --name mb-e2e -p 3000:3000 metabase/metabase:latest
npm run build
METABASE_URL=http://localhost:3000 npm run test:e2e
docker rm -f mb-e2e
```

On a fresh instance the test runs the setup wizard itself (`tests/e2e/metabase-setup.mjs`); against one that's already set up, also pass `E2E_ADMIN_EMAIL` and `E2E_ADMIN_PASSWORD`. The API key it creates is kept in memory and never printed. Each run leaves one fixture card behind; everything else it creates is deleted.

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

### Commit Messages and PR Titles

This repo uses [Conventional Commits](https://www.conventionalcommits.org/). PRs are **squash-merged**, so the **PR title** becomes the commit on `main`, and release-please reads those titles to pick the next version and write `CHANGELOG.md`. CI fails a PR whose title doesn't follow the format.

| Type | Use for | Release |
|------|---------|---------|
| `feat:` | New user-facing capability | minor |
| `fix:` | Bug fix | patch |
| `perf:` | Performance improvement | patch |
| `feat!:` / `fix!:` | Breaking change (or a `BREAKING CHANGE:` footer) | major |
| `docs:` `test:` `refactor:` `build:` `ci:` `chore:` `deps:` | Everything else | none |

- Optional scope: `fix(client): ...`, `feat(security): ...`
- Lowercase description in the imperative: `feat: add session token auth`
- Reference issues in the PR body (`Closes #45`)
- Use the same format for individual commits on a branch

### Releases

Don't bump versions by hand. On every push to `main`, release-please keeps a `chore(main): release X.Y.Z` PR open. It bumps `package.json`, `package-lock.json`, `src/version.ts`, `server.json` and `mcpb/manifest.json`, and `tests/unit/version.test.ts` fails if they drift. Merging that PR tags the release, and `.github/workflows/publish.yml` publishes to npm, attaches the `.mcpb` bundle to the GitHub release, and publishes to the official MCP registry.

### Dependency Updates

Dependabot (`.github/dependabot.yml`) opens grouped PRs weekly (npm) and monthly (GitHub Actions) with titles that pass the `pr-title` check: `fix(deps):` for runtime dependencies (patch release), `chore(deps-dev):` for dev dependencies, and `ci(deps):` for actions. Dev-dependency minor/patch PRs auto-merge once CI passes (`.github/workflows/dependabot-auto-merge.yml`); runtime, major and actions updates need a human. Regenerate lockfiles by hand with npm 10 (`npx npm@10 install`), since npm 11 drops optional `@emnapi/*` entries that CI's npm 10 rejects.
