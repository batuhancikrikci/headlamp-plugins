#!/usr/bin/env node
//
// Checks that the files every plugin shares are identical in all plugins: src/common/, the
// scripts, the TypeScript, Git, Prettier and VS Code configuration and the license.
// Each plugin keeps its own copy so it can be built and published on its own; this check keeps
// the copies from drifting apart. Change a shared file in one plugin, copy it unchanged to the
// others, then run:
//
//   node scripts/check-common.mjs
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const PLUGINS = [
  'agentrouter',
  'cilium',
  'envoy-gateway',
  'gateway',
  'headlamp-plus',
  'inference-hub',
  'monitoring',
  'multi-cluster',
];

const SHARED_FILES = [
  'scripts/build-icons.mjs',
  'scripts/deploy.mjs',
  'tsconfig.json',
  '.gitignore',
  '.prettierignore',
  'LICENSE',
  '.vscode/extensions.json',
  '.vscode/settings.json',
  '.vscode/tasks.json',
];
const SHARED_DIRS = ['src/common'];

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

function hash(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

const reference = PLUGINS[0];
const files = new Set(SHARED_FILES);
for (const plugin of PLUGINS) {
  for (const dir of SHARED_DIRS) {
    for (const file of walk(path.join(root, plugin, dir))) {
      files.add(path.relative(path.join(root, plugin), file));
    }
  }
}

const problems = [];
for (const file of [...files].sort()) {
  const hashes = new Map();
  for (const plugin of PLUGINS) {
    const full = path.join(root, plugin, file);
    const key = fs.existsSync(full) ? hash(full) : 'missing';
    hashes.set(key, [...(hashes.get(key) || []), plugin]);
  }
  if (hashes.size > 1) {
    const groups = [...hashes.entries()].map(([key, plugins]) =>
      key === 'missing' ? `missing in ${plugins.join(', ')}` : plugins.join(', ')
    );
    problems.push(`${file}\n    ${groups.join('\n    ')}`);
  }
}

if (problems.length > 0) {
  console.error(`Shared files differ between plugins (compare with ${reference}):\n`);
  console.error(problems.map(p => `  ${p}`).join('\n'));
  process.exit(1);
}
console.log(`${files.size} shared files are identical in ${PLUGINS.length} plugins.`);
