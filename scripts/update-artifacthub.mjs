#!/usr/bin/env node
//
// Points the Artifact Hub metadata of a plugin at a released tarball:
//
//   node scripts/update-artifacthub.mjs <plugin> <version> <archive-url> <sha256>
//
// Updates `version`, `createdAt`, `changes`, `headlamp/plugin/archive-url` and
// `headlamp/plugin/archive-checksum` in <plugin>/artifacthub-pkg.yml, as well as the tarball name
// and the pinned version in its `install` text, and replaces "unreleased"
// in the heading of the version's CHANGELOG.md entry with today's date. `changes` is taken from
// that CHANGELOG entry: items under "### Added", "### Fixed", ... get the matching Artifact Hub
// kind; items without a heading count as "added" in the first release and "changed" later.
// Used by the release workflow; it can also be run by hand.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [plugin, version, archiveUrl, checksum] = process.argv.slice(2);

if (!plugin || !version || !archiveUrl || !/^[0-9a-f]{64}$/.test(checksum || '')) {
  console.error('Usage: update-artifacthub.mjs <plugin> <version> <archive-url> <sha256>');
  process.exit(1);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

const file = path.join(root, plugin, 'artifacthub-pkg.yml');
const changelogFile = path.join(root, plugin, 'CHANGELOG.md');
for (const f of [file, changelogFile]) if (!fs.existsSync(f)) fail(`${f} does not exist.`);

const KINDS = ['added', 'changed', 'deprecated', 'removed', 'fixed', 'security'];
const escapeRegExp = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The CHANGELOG entry of `version` as Artifact Hub changes: [{ kind, description }]. */
function changesFromChangelog(changelog) {
  const heading = new RegExp(`^## \\[${escapeRegExp(version)}\\].*$`, 'm');
  const match = heading.exec(changelog);
  if (!match) fail(`${changelogFile}: no entry for ${version}.`);
  const rest = changelog.slice(match.index + match[0].length);
  const next = rest.search(/^## \[/m);
  const body = next === -1 ? rest : rest.slice(0, next);
  const firstRelease = next === -1;

  const changes = [];
  let kind = firstRelease ? 'added' : 'changed';
  let current;
  for (const line of body.split('\n')) {
    const section = /^### +(\w+)/.exec(line);
    if (section) {
      const k = section[1].toLowerCase();
      kind = KINDS.includes(k) ? k : 'changed';
      current = undefined;
    } else if (/^\s*[-*] +/.test(line)) {
      current = { kind, description: line.replace(/^\s*[-*] +/, '').trim() };
      changes.push(current);
    } else if (line.trim() === '') {
      current = undefined;
    } else if (current) {
      current.description += ` ${line.trim()}`;
    } else {
      current = { kind, description: line.trim() };
      changes.push(current);
    }
  }
  if (changes.length === 0) fail(`${changelogFile}: the entry for ${version} is empty.`);
  return changes;
}

let changelog = fs.readFileSync(changelogFile, 'utf8');
const changes = changesFromChangelog(changelog);
const today = new Date().toISOString().slice(0, 10);
changelog = changelog.replace(
  new RegExp(`^(## \\[${escapeRegExp(version)}\\].*?)unreleased$`, 'm'),
  `$1${today}`
);

// JSON strings are valid YAML double-quoted scalars.
const changesBlock =
  'changes:\n' +
  changes
    .map(c => `  - kind: ${c.kind}\n    description: ${JSON.stringify(c.description)}\n`)
    .join('');

const replacements = [
  [/^version: .*$/m, `version: ${version}`],
  [/^createdAt: .*$/m, `createdAt: "${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}"`],
  [/^(\s+headlamp\/plugin\/archive-url): .*$/m, `$1: ${archiveUrl}`],
  [/^(\s+headlamp\/plugin\/archive-checksum): .*$/m, `$1: sha256:${checksum}`],
];

let text = fs.readFileSync(file, 'utf8');
const previous = /^version: (.*)$/m.exec(text)?.[1].trim();
if (!previous) fail(`${file}: no version line.`);

// The install text names the tarball and pins the version in its Helm example.
text = text.replace(/^install: \|\n(?:(?: .*)?\n)*/m, block =>
  block
    .replaceAll(`${plugin}-${previous}.tar.gz`, `${plugin}-${version}.tar.gz`)
    .replace(new RegExp(`^(\\s+version: )${escapeRegExp(previous)}$`, 'm'), `$1${version}`)
);

for (const [pattern, value] of replacements) {
  if (!pattern.test(text)) fail(`${file}: no line matches ${pattern}.`);
  text = text.replace(pattern, value);
}
// Replace the previous `changes` block, or add one before `annotations`.
text = text.replace(/^changes:\n(?:[ -].*\n)*/m, '');
if (!/^annotations:/m.test(text)) fail(`${file}: no annotations block.`);
text = text.replace(/^annotations:/m, `${changesBlock}annotations:`);

fs.writeFileSync(file, text);
fs.writeFileSync(changelogFile, changelog);
console.log(`${plugin}/artifacthub-pkg.yml now points at ${version} (${changes.length} change(s)).`);
