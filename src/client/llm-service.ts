/**
 * LLM Service
 * Integrates with Claude API for NLQ features
 */

import Anthropic from '@anthropic-ai/sdk';
import type {
  LLMConfig,
  DatabaseSchema,
  SQLGenerationResult,
  SQLExample,
  InsightsResult,
  QueryResult,
} from './types.js';
import type { AuditLogger } from '../security/audit-logger.js';
import { BudgetExceededError } from '../utils/errors.js';

interface TokenBudget {
  dailyLimit: number;
  monthlyLimit: number;
  currentDaily: number;
  currentMonthly: number;
  lastDailyReset: Date;
  lastMonthlyReset: Date;
}

export class LLMService {
  private client: Anthropic;
  private config: LLMConfig;
  private budget: TokenBudget;
  private auditLogger: AuditLogger | null;

  constructor(apiKey: string, config: LLMConfig, auditLogger?: AuditLogger) {
    this.client = new Anthropic({ apiKey });
    this.config = config;
    this.auditLogger = auditLogger ?? null;

    this.budget = {
      dailyLimit: config.dailyTokenLimit,
      monthlyLimit: config.monthlyTokenLimit,
      currentDaily: 0,
      currentMonthly: 0,
      lastDailyReset: new Date(),
      lastMonthlyReset: new Date(),
    };
  }

  /**
   * Generate SQL from natural language question
   */
  async generateSQL(params: {
    question: string;
    schema: DatabaseSchema;
    examples?: SQLExample[];
  }): Promise<SQLGenerationResult> {
    this.checkBudget();

    const systemPrompt = this.buildSQLSystemPrompt(params.schema, params.examples);

    const response = await this.callWithRetry(async () => {
      return this.client.messages.create({
        model: this.config.model,
        max_tokens: 2048,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: `Generate a SQL query to answer: ${params.question}`,
          },
        ],
      });
    });

    this.trackUsage(response.usage.input_tokens, response.usage.output_tokens);

    return this.parseSQLResponse(response);
  }

  /**
   * Explain SQL query in plain English
   */
  async explainSQL(sql: string): Promise<string> {
    this.checkBudget();

    const response = await this.callWithRetry(async () => {
      return this.client.messages.create({
        model: this.config.model,
        max_tokens: 1024,
        messages: [
          {
            role: 'user',
            content: `Explain this SQL query in plain English. Be concise but thorough:\n\n${sql}`,
          },
        ],
      });
    });

    this.trackUsage(response.usage.input_tokens, response.usage.output_tokens);

    const content = response.content[0];
    return content.type === 'text' ? content.text : '';
  }

  /**
   * Suggest optimizations for SQL query
   */
  async optimizeSQL(sql: string, executionPlan?: string): Promise<{
    suggestions: string[];
    optimizedSQL?: string;
  }> {
    this.checkBudget();

    let prompt = `Analyze this SQL query and suggest optimizations:\n\n${sql}`;
    if (executionPlan) {
      prompt += `\n\nExecution plan:\n${executionPlan}`;
    }

    const response = await this.callWithRetry(async () => {
      return this.client.messages.create({
        model: this.config.model,
        max_tokens: 2048,
        system: `You are a SQL optimization expert. Provide practical suggestions to improve query performance.
Return your response as JSON with this structure:
{
  "suggestions": ["suggestion 1", "suggestion 2"],
  "optimizedSQL": "optimized query if applicable"
}`,
        messages: [{ role: 'user', content: prompt }],
      });
    });

    this.trackUsage(response.usage.input_tokens, response.usage.output_tokens);

    const content = response.content[0];
    if (content.type === 'text') {
      try {
        const jsonMatch = content.text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          return JSON.parse(jsonMatch[0]);
        }
      } catch {
        // Fall back to plain text response
      }
      return { suggestions: [content.text] };
    }

    return { suggestions: [] };
  }

  /**
   * Generate insights from query data
   */
  async generateInsights(params: {
    question: string;
    data: QueryResult;
    context?: string;
  }): Promise<InsightsResult> {
    this.checkBudget();

    // Prepare data sample for analysis — capped at 25 rows to control token usage
    const dataSample = params.data.data.rows.slice(0, 25);
    const columns = params.data.data.cols.map(c => c.name).join(', ');

    const response = await this.callWithRetry(async () => {
      return this.client.messages.create({
        model: this.config.model,
        max_tokens: 2048,
        system: `You are a data analyst. Analyze the provided data and generate actionable insights.
Be specific with numbers and percentages. Identify trends, anomalies, and recommendations.

Return your response as JSON:
{
  "summary": "Brief overall summary",
  "points": ["Key insight 1", "Key insight 2", ...],
  "recommendations": ["Recommendation 1", ...]
}`,
        messages: [
          {
            role: 'user',
            content: `Question: ${params.question}

Columns: ${columns}
Row count: ${params.data.row_count}
${params.context ? `Context: ${params.context}` : ''}

Data sample (first 100 rows):
${JSON.stringify(dataSample, null, 2)}

Provide insights based on this data.`,
          },
        ],
      });
    });

    this.trackUsage(response.usage.input_tokens, response.usage.output_tokens);

    return this.parseInsightsResponse(response);
  }

  /**
   * Identify relevant tables for a question
   */
  async identifyRelevantTables(
    question: string,
    schema: DatabaseSchema
  ): Promise<DatabaseSchema> {
    this.checkBudget();

    const tableList = schema.tables.map(t => `- ${t.name}: ${t.description || 'No description'}`).join('\n');

    const response = await this.callWithRetry(async () => {
      return this.client.messages.create({
        model: this.config.model,
        max_tokens: 256,
        system: 'Return ONLY a JSON array of table names that are relevant to answer the question. Example: ["users", "orders"]',
        messages: [
          {
            role: 'user',
            content: `Question: ${question}\n\nAvailable tables:\n${tableList}`,
          },
        ],
      });
    });

    this.trackUsage(response.usage.input_tokens, response.usage.output_tokens);

    const content = response.content[0];
    if (content.type === 'text') {
      try {
        const match = content.text.match(/\[[\s\S]*\]/);
        if (match) {
          const relevantNames: string[] = JSON.parse(match[0]);
          return {
            tables: schema.tables.filter(t =>
              relevantNames.some(name => t.name.toLowerCase() === name.toLowerCase())
            ),
          };
        }
      } catch {
        // Return original schema on parse error
      }
    }

    return schema;
  }

  /**
   * Get current token budget status
   */
  getBudgetStatus(): {
    dailyUsed: number;
    dailyRemaining: number;
    monthlyUsed: number;
    monthlyRemaining: number;
  } {
    this.resetBudgetIfNeeded();
    return {
      dailyUsed: this.budget.currentDaily,
      dailyRemaining: Math.max(0, this.budget.dailyLimit - this.budget.currentDaily),
      monthlyUsed: this.budget.currentMonthly,
      monthlyRemaining: Math.max(0, this.budget.monthlyLimit - this.budget.currentMonthly),
    };
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private buildSQLSystemPrompt(schema: DatabaseSchema, examples?: SQLExample[]): string {
    let prompt = `You are a SQL expert. Generate valid, safe SQL queries based on the database schema.

DATABASE SCHEMA:
`;

    for (const table of schema.tables) {
      prompt += `\nTable: ${table.name}`;
      if (table.description) {
        prompt += ` -- ${table.description}`;
      }
      prompt += '\nColumns:\n';
      for (const col of table.columns) {
        prompt += `  - ${col.name} (${col.type})`;
        if (col.description) {
          prompt += ` -- ${col.description}`;
        }
        prompt += '\n';
      }
    }

    if (examples?.length) {
      prompt += '\nEXAMPLES:\n';
      for (const ex of examples) {
        prompt += `Q: ${ex.question}\nSQL: ${ex.sql}\n\n`;
      }
    }

    prompt += `
RULES:
1. Only generate SELECT queries - no INSERT, UPDATE, DELETE, DROP, etc.
2. Use proper table aliases for readability
3. Include appropriate WHERE clauses for filtering
4. Always add LIMIT 1000 unless the question specifies otherwise
5. Use standard SQL syntax (PostgreSQL-compatible)
6. For aggregations, include GROUP BY as needed
7. Order results logically (e.g., by date DESC for recent data)

Return ONLY the SQL query. No explanations, no markdown code blocks.`;

    return prompt;
  }

  private parseSQLResponse(response: Anthropic.Message): SQLGenerationResult {
    const content = response.content[0];
    if (content.type !== 'text') {
      return { sql: '', explanation: 'Failed to generate SQL' };
    }

    let sql = content.text.trim();

    // Remove markdown code blocks if present
    sql = sql.replace(/```sql\n?/gi, '').replace(/```\n?/g, '');

    // Extract just the SQL if there's extra text
    const selectMatch = sql.match(/SELECT[\s\S]+/i);
    const withMatch = sql.match(/WITH[\s\S]+/i);

    if (withMatch) {
      sql = withMatch[0];
    } else if (selectMatch) {
      sql = selectMatch[0];
    }

    return {
      sql: sql.trim(),
      explanation: undefined,
    };
  }

  private parseInsightsResponse(response: Anthropic.Message): InsightsResult {
    const content = response.content[0];
    if (content.type !== 'text') {
      return { summary: 'Failed to generate insights', points: [] };
    }

    try {
      const jsonMatch = content.text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          summary: parsed.summary || 'No summary available',
          points: parsed.points || [],
          recommendations: parsed.recommendations,
        };
      }
    } catch {
      // Fall back to plain text
    }

    return {
      summary: content.text,
      points: [],
    };
  }

  private async callWithRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.config.retryAttempts; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Don't retry on budget errors
        if (error instanceof BudgetExceededError) {
          throw error;
        }

        // Don't retry on the last attempt
        if (attempt < this.config.retryAttempts) {
          await this.delay(this.config.retryDelayMs * (attempt + 1));
        }
      }
    }

    throw lastError ?? new Error('LLM call failed');
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private checkBudget(): void {
    this.resetBudgetIfNeeded();

    if (this.budget.currentDaily >= this.budget.dailyLimit) {
      throw new BudgetExceededError('Daily token limit reached', 'daily');
    }

    if (this.budget.currentMonthly >= this.budget.monthlyLimit) {
      throw new BudgetExceededError('Monthly token limit reached', 'monthly');
    }
  }

  private resetBudgetIfNeeded(): void {
    const now = new Date();

    // Reset daily budget at midnight UTC
    if (now.getUTCDate() !== this.budget.lastDailyReset.getUTCDate()) {
      this.budget.currentDaily = 0;
      this.budget.lastDailyReset = now;
    }

    // Reset monthly budget on the 1st
    if (now.getUTCMonth() !== this.budget.lastMonthlyReset.getUTCMonth()) {
      this.budget.currentMonthly = 0;
      this.budget.lastMonthlyReset = now;
    }
  }

  private trackUsage(inputTokens: number, outputTokens: number): void {
    const total = inputTokens + outputTokens;
    this.budget.currentDaily += total;
    this.budget.currentMonthly += total;

    this.auditLogger?.logLLMUsage(inputTokens, outputTokens, this.config.model);
  }
}
