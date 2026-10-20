#!/usr/bin/env node
//
// Generates src/icons/bundle.json: the icons the plugin references, so @iconify/react never
// fetches an icon from the Iconify CDN at runtime and the plugin works without internet access.
// (Headlamp itself only bundles the icons of its own UI.) src/common/icons.ts registers them.
//
// Icons are collected by scanning src/ for "mdi:<name>" and "simple-icons:<name>" literals, so a
// newly used icon is picked up automatically by `npm start`, `build`, `package` and `storybook`.
// A collection is only loaded when the plugin uses one of its icons.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(root, 'src');
const outFile = path.join(srcDir, 'icons', 'bundle.json');

const COLLECTIONS = {
  mdi: '@iconify-json/mdi/icons.json',
  'simple-icons': '@iconify-json/simple-icons/icons.json',
};

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return /\.(tsx?|mjs)$/.test(entry.name) ? [full] : [];
  });
}

const wanted = Object.fromEntries(Object.keys(COLLECTIONS).map(prefix => [prefix, new Set()]));
const pattern = /['"`](mdi|simple-icons):([a-z0-9-]+)['"`]/g;
for (const file of walk(srcDir)) {
  for (const match of fs.readFileSync(file, 'utf8').matchAll(pattern)) {
    wanted[match[1]].add(match[2]);
  }
}

const collections = [];
const missing = [];
for (const [prefix, modulePath] of Object.entries(COLLECTIONS)) {
  if (wanted[prefix].size === 0) continue;
  let full;
  try {
    full = JSON.parse(fs.readFileSync(require.resolve(modulePath), 'utf8'));
  } catch {
    console.error(
      `icons: ${modulePath} is missing; add ${
        modulePath.split('/icons.json')[0]
      } to devDependencies.`
    );
    process.exit(1);
  }
  const icons = {};
  const aliases = {};
  for (const name of [...wanted[prefix]].sort()) {
    if (full.icons[name]) {
      icons[name] = full.icons[name];
    } else if (full.aliases?.[name] && full.icons[full.aliases[name].parent]) {
      aliases[name] = full.aliases[name];
      icons[full.aliases[name].parent] = full.icons[full.aliases[name].parent];
    } else {
      missing.push(`${prefix}:${name}`);
    }
  }
  collections.push({
    prefix,
    width: full.width,
    height: full.height,
    icons,
    ...(Object.keys(aliases).length ? { aliases } : {}),
  });
}

fs.mkdirSync(path.dirname(outFile), { recursive: true });
const next = `${JSON.stringify(collections)}\n`;
const previous = fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8') : '';
if (next !== previous) fs.writeFileSync(outFile, next);

const total = collections.reduce((sum, c) => sum + Object.keys(c.icons).length, 0);
console.log(`icons: bundled ${total} icons into src/icons/bundle.json`);
if (missing.length) {
  console.error(`icons: unknown icon ids: ${missing.join(', ')}`);
  process.exit(1);
}
