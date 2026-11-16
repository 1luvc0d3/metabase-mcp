import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { VERSION } from '../../src/version.js';

// release-please bumps every one of these on release (see release-please-config.json).
// If this test fails, a version location was edited by hand or is missing from extra-files.
const readJson = (path: string) => JSON.parse(readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8'));

describe('version sync', () => {
  const pkg = readJson('package.json');
  const lock = readJson('package-lock.json');
  const server = readJson('server.json');
  const mcpb = readJson('mcpb/manifest.json');
  const manifest = readJson('.release-please-manifest.json');

  it.each([
    ['package-lock.json', lock.version],
    ['package-lock.json packages[""]', lock.packages[''].version],
    ['src/version.ts', VERSION],
    ['server.json', server.version],
    ['server.json packages[0]', server.packages[0].version],
    ['mcpb/manifest.json', mcpb.version],
    ['.release-please-manifest.json', manifest['.']],
  ])('%s matches package.json', (_location, version) => {
    expect(version).toBe(pkg.version);
  });
});
