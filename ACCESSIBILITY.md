# Accessibility

metabase-mcp has no user interface of its own. People use it through an MCP client (Claude Desktop, Claude Code, claude.ai and others), so the accessibility of the conversation itself depends on that client. This project is responsible for its documentation, its setup steps and the text it returns.

## What we aim for

- **Documentation** is plain Markdown with real headings, descriptive link text and tables with header rows, so it works with screen readers and GitHub's rendering. Images, if added, get alt text that says what they show.
- **Setup** can be done entirely from the keyboard: a one-click `.mcpb` install in Claude Desktop, a single terminal command, or a `docker compose` file.
- **Tool results and errors** are plain text or JSON, never color or formatting alone, so the client can present them however its user needs. Error messages say what went wrong and what to change.
- **Logs** are plain text on stderr and JSON lines in the audit log, readable with any tool.

## Known limitations

- We don't control how MCP clients present tool calls, results or approval prompts. Report problems with those to the client's maker.
- Charts and visualizations live in Metabase. Their accessibility is Metabase's.

## Reporting a barrier

If something in the docs, setup or output gets in your way, [open an issue](https://github.com/1luvc0d3/metabase-mcp/issues/new/choose) and describe what you were trying to do and what assistive technology you use, if any. We treat accessibility problems as bugs.
