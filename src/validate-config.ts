#!/usr/bin/env node
/**
 * Validate Metabase MCP configuration from environment variables.
 * Usage: npm run validate-config
 */

import { loadConfig, validateConfig } from './config.js';

async function main(): Promise<void> {
  console.log('Validating Metabase MCP configuration...\n');

  try {
    const config = loadConfig();
    console.log(`  Metabase URL: ${config.metabase.url}`);
    console.log(`  Server mode:  ${config.mode}`);
    console.log(`  Anthropic:    ${config.anthropicApiKey ? 'configured' : 'not set (NLQ disabled)'}`);
    console.log('');

    const result = await validateConfig(config);

    if (result.warnings.length > 0) {
      console.log('Warnings:');
      for (const w of result.warnings) {
        console.log(`  ! ${w}`);
      }
      console.log('');
    }

    if (result.errors.length > 0) {
      console.log('Errors:');
      for (const e of result.errors) {
        console.log(`  x ${e}`);
      }
      console.log('');
      process.exit(1);
    }

    console.log('Configuration is valid.');
  } catch (error) {
    if (error instanceof Error) {
      console.error(`Configuration error: ${error.message}`);
    }
    process.exit(1);
  }
}

main();
