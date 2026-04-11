/**
 * Schema Manager
 * Caches and manages database schemas for NLQ operations
 */

import type { MetabaseClient } from '../client/metabase-client.js';
import type { DatabaseMetadata, DatabaseSchema, SchemaTable, SchemaColumn } from '../client/types.js';

interface CachedSchema {
  schema: DatabaseSchema;
  fetchedAt: Date;
  expiresAt: Date;
}

export interface SchemaManagerConfig {
  ttlMs?: number;
  maxTables?: number;
  maxColumnsPerTable?: number;
}

export class SchemaManager {
  private cache: Map<number, CachedSchema> = new Map();
  private readonly ttlMs: number;
  private readonly maxTables: number;
  private readonly maxColumnsPerTable: number;

  constructor(
    private metabaseClient: MetabaseClient,
    config: SchemaManagerConfig = {}
  ) {
    this.ttlMs = config.ttlMs ?? 60 * 60 * 1000; // 1 hour default
    this.maxTables = config.maxTables ?? 100;
    this.maxColumnsPerTable = config.maxColumnsPerTable ?? 50;
  }

  /**
   * Get schema for a database (from cache or fetch)
   */
  async getSchema(databaseId: number): Promise<DatabaseSchema> {
    const cached = this.cache.get(databaseId);

    // Return cached if still valid
    if (cached && new Date() < cached.expiresAt) {
      return cached.schema;
    }

    // Fetch fresh schema
    const rawSchema = await this.metabaseClient.getDatabaseSchema(databaseId);
    const processedSchema = this.processSchema(rawSchema);

    // Update cache
    this.cache.set(databaseId, {
      schema: processedSchema,
      fetchedAt: new Date(),
      expiresAt: new Date(Date.now() + this.ttlMs),
    });

    return processedSchema;
  }

  /**
   * Get schema filtered to specific tables
   */
  async getFilteredSchema(databaseId: number, tableNames: string[]): Promise<DatabaseSchema> {
    const fullSchema = await this.getSchema(databaseId);

    return {
      tables: fullSchema.tables.filter(t =>
        tableNames.some(name => t.name.toLowerCase() === name.toLowerCase())
      ),
    };
  }

  /**
   * Force refresh schema for a database
   */
  async refreshSchema(databaseId: number): Promise<DatabaseSchema> {
    this.cache.delete(databaseId);
    return this.getSchema(databaseId);
  }

  /**
   * Clear all cached schemas
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Check if schema is cached and valid
   */
  isCached(databaseId: number): boolean {
    const cached = this.cache.get(databaseId);
    return cached !== undefined && new Date() < cached.expiresAt;
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    cachedDatabases: number;
    entries: Array<{ databaseId: number; expiresIn: number; tableCount: number }>;
  } {
    const entries: Array<{ databaseId: number; expiresIn: number; tableCount: number }> = [];

    for (const [databaseId, cached] of this.cache) {
      entries.push({
        databaseId,
        expiresIn: Math.max(0, cached.expiresAt.getTime() - Date.now()),
        tableCount: cached.schema.tables.length,
      });
    }

    return {
      cachedDatabases: this.cache.size,
      entries,
    };
  }

  /**
   * Process raw Metabase schema into optimized format for LLM
   */
  private processSchema(raw: DatabaseMetadata): DatabaseSchema {
    let tables = raw.tables;

    // Handle large schemas by prioritizing important tables
    if (tables.length > this.maxTables) {
      tables = this.prioritizeTables(tables).slice(0, this.maxTables);
    }

    return {
      tables: tables.map(t => this.processTable(t)),
    };
  }

  /**
   * Process a single table
   */
  private processTable(table: DatabaseMetadata['tables'][0]): SchemaTable {
    // Limit columns per table
    const columns = table.fields
      .slice(0, this.maxColumnsPerTable)
      .map(f => this.processColumn(f));

    return {
      name: table.name,
      description: table.description,
      columns,
    };
  }

  /**
   * Process a single column
   */
  private processColumn(field: DatabaseMetadata['tables'][0]['fields'][0]): SchemaColumn {
    return {
      name: field.name,
      type: this.simplifyType(field.base_type),
      description: field.description,
    };
  }

  /**
   * Simplify Metabase types for LLM consumption
   */
  private simplifyType(baseType: string): string {
    const typeMap: Record<string, string> = {
      'type/Integer': 'INTEGER',
      'type/BigInteger': 'BIGINT',
      'type/Float': 'FLOAT',
      'type/Decimal': 'DECIMAL',
      'type/Text': 'TEXT',
      'type/Boolean': 'BOOLEAN',
      'type/Date': 'DATE',
      'type/DateTime': 'DATETIME',
      'type/Time': 'TIME',
      'type/UUID': 'UUID',
      'type/JSON': 'JSON',
    };

    return typeMap[baseType] || baseType.replace('type/', '');
  }

  /**
   * Prioritize tables for large schemas
   */
  private prioritizeTables(tables: DatabaseMetadata['tables']): DatabaseMetadata['tables'] {
    return [...tables].sort((a, b) => {
      // Prioritize tables with foreign keys (more connected = more important)
      const aFKs = a.fields.filter(f => f.fk_target_field_id !== null).length;
      const bFKs = b.fields.filter(f => f.fk_target_field_id !== null).length;
      if (aFKs !== bFKs) return bFKs - aFKs;

      // Then by column count (prefer smaller, more focused tables)
      return a.fields.length - b.fields.length;
    });
  }

  /**
   * Format schema as text for LLM prompt
   */
  formatSchemaForPrompt(schema: DatabaseSchema): string {
    let output = 'DATABASE SCHEMA:\n\n';

    for (const table of schema.tables) {
      output += `Table: ${table.name}`;
      if (table.description) {
        output += ` -- ${table.description}`;
      }
      output += '\n';

      output += 'Columns:\n';
      for (const col of table.columns) {
        output += `  - ${col.name} (${col.type})`;
        if (col.description) {
          output += ` -- ${col.description}`;
        }
        output += '\n';
      }
      output += '\n';
    }

    return output;
  }
}
