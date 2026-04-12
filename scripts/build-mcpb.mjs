#!/usr/bin/env node
/**
 * Build the .mcpb Claude Desktop Extension bundle.
 *
 * Output: metabase-mcp-<version>.mcpb at repo root
 */

import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = process.cwd();
const stagingDir = join(repoRoot, 'build', 'mcpb-staging');
const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
const manifest = JSON.parse(readFileSync(join(repoRoot, 'mcpb', 'manifest.json'), 'utf8'));

// Keep manifest version in sync with package.json version
if (manifest.version !== pkg.version) {
  console.log(`Syncing manifest version: ${manifest.version} → ${pkg.version}`);
  manifest.version = pkg.version;
}

const outputFile = join(repoRoot, `metabase-mcp-${pkg.version}.mcpb`);

console.log(`Building ${outputFile}`);

// 1. Clean staging
if (existsSync(stagingDir)) {
  rmSync(stagingDir, { recursive: true, force: true });
}
mkdirSync(stagingDir, { recursive: true });

// 2. Copy compiled server + metadata
console.log('  Copying files...');
cpSync(join(repoRoot, 'dist'), join(stagingDir, 'dist'), { recursive: true });
cpSync(join(repoRoot, 'mcpb', 'icon.png'), join(stagingDir, 'icon.png'));
cpSync(join(repoRoot, 'README.md'), join(stagingDir, 'README.md'));
cpSync(join(repoRoot, 'LICENSE'), join(stagingDir, 'LICENSE'));

// 3. Write trimmed package.json (for npm ci to resolve prod deps)
const stagingPkg = {
  name: pkg.name,
  version: pkg.version,
  type: pkg.type,
  main: pkg.main,
  dependencies: pkg.dependencies,
};
writeFileSync(join(stagingDir, 'package.json'), JSON.stringify(stagingPkg, null, 2));

// 4. Copy lockfile so npm ci works
cpSync(join(repoRoot, 'package-lock.json'), join(stagingDir, 'package-lock.json'));

// 5. Write manifest with synced version
writeFileSync(join(stagingDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

// 6. Install prod dependencies in staging
console.log('  Installing production dependencies...');
execSync('npm ci --omit=dev --ignore-scripts', {
  cwd: stagingDir,
  stdio: 'inherit',
});

// 7. Pack using @anthropic-ai/mcpb
console.log('  Packing bundle...');
execSync(`npx --yes @anthropic-ai/mcpb pack "${stagingDir}" "${outputFile}"`, {
  cwd: repoRoot,
  stdio: 'inherit',
});

console.log(`\n✓ Built ${outputFile}`);
