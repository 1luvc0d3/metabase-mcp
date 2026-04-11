# Contributing to metabase-mcp

Thanks for your interest in contributing! Here's how to get started.

## Development Setup

1. Clone the repo:
   ```bash
   git clone https://github.com/1luvc0d3/metabase-mcp.git
   cd metabase-mcp
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Build the project:
   ```bash
   npm run build
   ```

4. Run tests:
   ```bash
   npm test
   ```

## Running in Development

```bash
npm run dev  # Watch mode - recompiles on file changes
```

To test against a real Metabase instance, copy `.env.example` to `.env` and fill in your credentials:

```bash
cp .env.example .env
# Edit .env with your METABASE_URL and METABASE_API_KEY
node test-connection.mjs  # Verify connectivity
```

## Project Structure

```
src/
  index.ts              # Entry point
  config.ts             # Environment config loading
  client/
    metabase-client.ts  # Metabase REST API wrapper
    llm-service.ts      # Anthropic Claude API integration
    types.ts            # TypeScript types
  tools/
    read-tools.ts       # Read-only MCP tools
    write-tools.ts      # Write MCP tools
    nlq-tools.ts        # Natural language query tools
    insight-tools.ts    # Data insight tools
  security/
    sql-guardrails.ts   # SQL validation and injection prevention
    rate-limiter.ts     # Rate limiting
    audit-logger.ts     # Operation logging
  utils/
    schema-manager.ts   # Database schema caching
    errors.ts           # Custom error types
tests/
  unit/                 # Unit tests
  integration/          # Integration tests
  fixtures/             # Test data
```

## Pull Request Process

1. Create a feature branch from `main`
2. Make your changes
3. Ensure tests pass: `npm test`
4. Ensure types check: `npm run type-check`
5. Submit a pull request

## Branch Naming

- `feature/` - New features
- `fix/` - Bug fixes
- `docs/` - Documentation
- `refactor/` - Code refactoring
- `test/` - Test additions
