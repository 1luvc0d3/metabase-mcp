# Tools and examples

All tools return compact JSON by default (about half the tokens of pretty-printed output); pass `format: "default"` to pretty-print.

## Tools

| Category | Available in | Tools |
|----------|--------------|-------|
| Read | all modes | `list_dashboards`, `get_dashboard`, `list_cards`, `get_card`, `execute_card`, `list_databases`, `get_database_schema`, `execute_query`, `search_content`, `get_collections` |
| Batch & workflow | all modes | `batch_execute`, `run_workflow` |
| Write | `write`, `full` | `create_card`, `update_card`, `delete_card`, `create_dashboard`, `update_dashboard`, `delete_dashboard`, `add_card_to_dashboard`, `remove_card_from_dashboard`, `create_collection`, `move_to_collection` |
| NLQ | needs `ANTHROPIC_API_KEY` | `nlq_to_sql`, `explain_sql`, `optimize_sql`, `validate_sql` |
| Insights | `full` + `ANTHROPIC_API_KEY` | `ask_data`, `generate_insights`, `compare_metrics`, `trend_analysis` |

In `write`/`full` mode, `batch_execute` and `run_workflow` also accept the non-destructive write tools (`create_card`, `update_card`, `create_dashboard`, `update_dashboard`, `add_card_to_dashboard`, `create_collection`, `move_to_collection`). Delete and remove operations are never batchable — they must be explicit single tool calls.

## Examples

### Exploring your data

> **You**: What dashboards do we have related to customer retention?

Claude uses `search_content` to find retention-related dashboards, then `get_dashboard` to summarize the key metrics.

> **You**: Run the "Monthly Active Users" card for the last 90 days

Claude calls `list_cards` to locate the card, then `execute_card` with the appropriate time filter. Results come back as a table you can ask follow-up questions about ("what was the biggest dip and when?").

### Ad-hoc SQL with safety rails

> **You**: Show me the top 10 products by revenue last quarter from the sales database

Claude calls `list_databases` to find the sales database, `get_database_schema` to inspect the relevant tables, then generates and runs a `SELECT` query via `execute_query`. The query is validated against the SQL guardrails (no `DROP`/`DELETE`/`UNION`, single statement only) before execution, and an audit log entry is written with the query and row count.

> **You**: DROP TABLE users

The request is blocked: *"Blocked SQL pattern detected: DROP — this operation is not allowed."* The block is logged as a high-risk audit event.

### Natural language to SQL (needs `ANTHROPIC_API_KEY`)

> **You**: Which support agents closed the most tickets this week, and how does that compare to last week?

Claude uses `nlq_to_sql` with the database schema as context to generate a comparative SQL query. You can ask it to `explain_sql` in plain English before running, or `optimize_sql` to suggest performance improvements — all before hitting your database.

### Saving a reusable query as a card (write mode)

> **You**: Save the MAU trend query we just ran as a card called "MAU — Last 90 Days" in the Growth collection

Claude calls `get_collections` to find "Growth", then `create_card` with your validated SQL. The card can be re-executed by name in future conversations via `execute_card`, with no LLM tokens spent re-generating the query.

### Batch execution — parallel data gathering

> **You**: Get me the details for dashboards 1, 3, and 7, plus the schema for the sales database

```json
{
  "operations": [
    { "tool": "get_dashboard", "args": { "dashboard_id": 1 } },
    { "tool": "get_dashboard", "args": { "dashboard_id": 3 } },
    { "tool": "get_dashboard", "args": { "dashboard_id": 7 } },
    { "tool": "get_database_schema", "args": { "database_id": 2 } }
  ]
}
```

One tool call instead of four, up to 20 operations per call. Results come back with per-operation success/failure, so partial failures don't block the rest.

### Workflow pipelines — chained multi-step operations

> **You**: Find dashboards about revenue, get the first one's cards, and run the top card

```json
{
  "steps": [
    { "name": "find", "tool": "search_content", "args": { "query": "revenue", "type": "dashboard" } },
    { "name": "dash", "tool": "get_dashboard", "args": { "dashboard_id": "$find.results[0].id" } },
    { "name": "data", "tool": "execute_card", "args": { "card_id": "$dash.dashcards[0].card_id" } }
  ]
}
```

Each step can reference results from previous steps with `$stepName.path[index].field`. One round trip instead of three.

In `write`/`full` mode, pipelines can also build content:

> **You**: Save this query as a card and put it on a new "Growth" dashboard

```json
{
  "steps": [
    { "name": "card", "tool": "create_card", "args": { "name": "MAU Trend", "database_id": 2, "sql": "SELECT ..." } },
    { "name": "dash", "tool": "create_dashboard", "args": { "name": "Growth" } },
    { "name": "link", "tool": "add_card_to_dashboard", "args": { "dashboard_id": "$dash.id", "card_id": "$card.id" } }
  ]
}
```

Write steps go through the same guardrails as the standalone write tools: write-tier rate limiting, SQL validation, and per-operation audit logging. Destructive operations (deletes/removes) are not allowed in pipelines.

### Automated insights (full mode)

> **You**: Run last quarter's revenue query and tell me what's interesting

Claude uses `execute_query` to run the query, then `generate_insights`, which asks the Claude API to identify trends, outliers, and recommendations. You get a headline number, 3-5 bullet points, and suggested follow-up questions.

> **Data privacy:** `generate_insights`, `ask_data`, `compare_metrics`, and `trend_analysis` send query result rows to the Anthropic API. See [Data privacy](security.md#data-privacy).
