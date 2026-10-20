#!/usr/bin/env node
//
// Keeps the `digest` of the Artifact Hub metadata up to date:
//
//   node scripts/artifacthub-digest.mjs [--check] [<plugin> ...]
//
// Artifact Hub processes a package version again only when its `digest` changes. The digest is
// the SHA-256 of what Artifact Hub shows for the version: <plugin>/artifacthub-pkg.yml (without
// its digest line), <plugin>/README.md and the logo. Run this after changing any of them, so the
// change reaches Artifact Hub and the Headlamp plugin catalog. --check only reports outdated
// digests (exit code 1). Without plugin names, every plugin with an artifacthub-pkg.yml is used.
// update-artifacthub.mjs updates the digest of a released plugin itself.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIGEST_LINE = /^digest: .*\n/m;

/** The digest the metadata of `plugin` should have. */
export function expectedDigest(plugin) {
  const dir = path.join(root, plugin);
  const metadata = fs.readFileSync(path.join(dir, 'artifacthub-pkg.yml'), 'utf8');
  const hash = crypto.createHash('sha256');
  hash.update(metadata.replace(DIGEST_LINE, ''));
  hash.update(fs.readFileSync(path.join(dir, 'README.md')));
  const logo = /^logoPath: *['"]?([^'"\n]+)/m.exec(metadata)?.[1];
  if (logo) hash.update(fs.readFileSync(path.join(dir, logo.trim())));
  return hash.digest('hex');
}

/** The digest currently written in the metadata of `plugin`, if any. */
export function currentDigest(plugin) {
  const metadata = fs.readFileSync(path.join(root, plugin, 'artifacthub-pkg.yml'), 'utf8');
  return /^digest: *['"]?([0-9a-f]+)/m.exec(metadata)?.[1];
}

/** Writes the expected digest into the metadata of `plugin`; returns whether it changed. */
export function writeDigest(plugin) {
  const file = path.join(root, plugin, 'artifacthub-pkg.yml');
  const digest = expectedDigest(plugin);
  if (currentDigest(plugin) === digest) return false;
  let text = fs.readFileSync(file, 'utf8');
  const line = `digest: "${digest}"\n`;
  if (DIGEST_LINE.test(text)) {
    text = text.replace(DIGEST_LINE, line);
  } else if (/^createdAt: .*\n/m.test(text)) {
    text = text.replace(/^(createdAt: .*\n)/m, `$1${line}`);
  } else {
    throw new Error(`${file}: no createdAt line to put the digest after.`);
  }
  fs.writeFileSync(file, text);
  return true;
}

function plugins() {
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter(
      entry =>
        entry.isDirectory() && fs.existsSync(path.join(root, entry.name, 'artifacthub-pkg.yml'))
    )
    .map(entry => entry.name)
    .sort();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const names = args.filter(arg => arg !== '--check');
  const selected = names.length > 0 ? names : plugins();
  let outdated = 0;
  for (const plugin of selected) {
    if (!fs.existsSync(path.join(root, plugin, 'artifacthub-pkg.yml'))) {
      console.error(`${plugin}: no artifacthub-pkg.yml`);
      process.exit(1);
    }
    if (check) {
      if (currentDigest(plugin) !== expectedDigest(plugin)) {
        console.log(`${plugin}: digest is outdated`);
        outdated++;
      }
    } else if (writeDigest(plugin)) {
      console.log(`${plugin}: digest updated`);
    }
  }
  if (check && outdated > 0) {
    console.log('Run `node scripts/artifacthub-digest.mjs` to update them.');
    process.exit(1);
  }
  if (check) console.log(`${selected.length} digest(s) up to date.`);
}
