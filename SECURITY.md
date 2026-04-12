# Security Policy

## Supported Versions

Only the latest minor version receives security updates.

| Version | Supported |
|---------|:---------:|
| 1.0.x   | Yes       |
| < 1.0   | No        |

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Report security issues privately through GitHub's [Private Vulnerability Reporting](https://github.com/1luvc0d3/metabase-mcp/security/advisories/new):

1. Go to the [Security tab](https://github.com/1luvc0d3/metabase-mcp/security)
2. Click **Report a vulnerability**
3. Fill in the form with reproduction steps and impact assessment

You should receive an initial response within **5 business days**. If the issue is confirmed, a fix will be prioritized and released, typically within:

- **Critical** (remote code execution, auth bypass): 7 days
- **High** (data exposure, privilege escalation): 14 days
- **Medium / Low**: next scheduled release

## What to Include

A good report includes:
- Affected version(s)
- Reproduction steps or proof-of-concept
- Expected vs actual behavior
- Potential impact (what an attacker could do)
- Suggested fix (if you have one)

## Scope

**In scope:**
- Code in this repository (`src/`)
- Published npm package `@ai-1luvc0d3/metabase-mcp`
- Authentication / authorization flaws in the MCP server
- SQL injection or guardrail bypasses
- Secret leakage in logs, errors, or responses
- Supply chain issues (malicious dependencies)

**Out of scope:**
- Vulnerabilities in Metabase itself — report to [Metabase](https://www.metabase.com/security)
- Vulnerabilities in Anthropic's Claude API — report to [Anthropic](https://www.anthropic.com/responsible-disclosure)
- Vulnerabilities in upstream dependencies (report upstream; we'll apply patches via Dependabot)
- Issues requiring physical access to the user's machine
- DoS via resource exhaustion (rate limits are configurable)
- Social engineering attacks

## Security Posture

This server implements multiple defensive layers:

- **SQL Guardrails** (`src/security/sql-guardrails.ts`) — validates every query against a pattern blocklist (DROP, DELETE, UNION, xp_cmdshell, SLEEP, INTO OUTFILE, etc.), enforces single-statement execution, and auto-appends LIMIT clauses.
- **Tiered Rate Limiting** (`src/security/rate-limiter.ts`) — configurable per-minute limits for read, write, and LLM operations.
- **Audit Logging** (`src/security/audit-logger.ts`) — every operation logged with risk level. Sensitive fields (`apiKey`, `password`, `token`, etc.) automatically redacted. Log files created with owner-only permissions (0600).
- **Secret Isolation** — API keys are never exposed to tool handlers. Error responses from Metabase are sanitized before being returned.
- **Redirect Protection** — HTTP redirects are rejected so API keys are never forwarded to redirect targets.

## Known Limitations

Documented in the [README's Data Privacy section](README.md#data-privacy-note):

- When NLQ or insight tools are used, query result data is sent to the Anthropic API for analysis. Users should evaluate this against their data governance policies before enabling NLQ features on databases with sensitive data.
- PII-aware redaction before LLM calls is tracked as [roadmap item #16](https://github.com/1luvc0d3/metabase-mcp/issues/16).

## Disclosure Policy

We follow **coordinated disclosure**:
1. Reporter submits issue privately
2. We confirm and investigate
3. Fix is developed and released
4. Advisory is published, crediting the reporter (unless they prefer anonymity)
5. Public disclosure happens 30 days after the fix is released

Thank you for helping keep this project secure.
