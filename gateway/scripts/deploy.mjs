#!/usr/bin/env node
//
// Builds the plugin and installs it into the local Headlamp desktop app (Linux, macOS, Windows).
//
//   npm run deploy                        # icons, type-check, lint, test, build, install
//   npm run deploy:fast                   # icons, build, install
//   npm run deploy -- --strict            # fail instead of warn on conflicting plugins
//   HEADLAMP_PLUGINS_DIR=/path npm run deploy
//
// For day-to-day development prefer `npm start`: it rebuilds on every change and copies the
// result to the same plugins directory automatically.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const name = pkg.name.split('/').pop();
const args = process.argv.slice(2);
const skipChecks = args.includes('--skip-checks') || process.env.SKIP_CHECKS === '1';
const strict = args.includes('--strict');

// Leftovers of an interrupted run; they sit next to the install and must never be loaded.
const TEMP_PREFIXES = [`.${name}.staging-`, `.${name}.previous-`];
// Built plugins call this to add themes; two theme-locking plugins would fight over the theme.
const THEME_PLUGIN_MARKER = 'registerAppTheme';

function fail(message) {
  console.error(`\n❌ ${message}`);
  process.exit(1);
}

function step(message) {
  console.log(`\n\x1b[1;34m▶ ${message}\x1b[0m`);
}

function run(command, env = {}) {
  try {
    execSync(command, { stdio: 'inherit', env: { ...process.env, ...env } });
  } catch {
    fail(`"${command}" failed; see the output above.`);
  }
}

// Headlamp's base directories, as computed by env-paths('Headlamp', { suffix: '' }).
function headlampBaseDirs() {
  const home = os.homedir();
  if (process.platform === 'darwin') {
    return {
      data: path.join(home, 'Library', 'Application Support', 'Headlamp'),
      config: path.join(home, 'Library', 'Preferences', 'Headlamp'),
    };
  }
  if (process.platform === 'win32') {
    return {
      data: path.join(
        process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'),
        'Headlamp',
        'Data'
      ),
      config: path.join(
        process.env.APPDATA || path.join(home, 'AppData', 'Roaming'),
        'Headlamp',
        'Config'
      ),
    };
  }
  return {
    data: path.join(process.env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'Headlamp'),
    config: path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'Headlamp'),
  };
}

// Same lookup as `headlamp-plugin start` and the desktop app: the data directory wins when it exists.
function defaultPluginsDir() {
  const { data, config } = headlampBaseDirs();
  return path.join(fs.existsSync(data) ? data : config, 'plugins');
}

/** Retries operations Windows rejects while Headlamp holds a file open. */
function withRetry(action, description) {
  for (let attempt = 1; ; attempt++) {
    try {
      return action();
    } catch (error) {
      const busy = ['EBUSY', 'EPERM', 'EACCES', 'ENOTEMPTY'].includes(error.code);
      if (!busy || attempt === 5) {
        throw new Error(
          `Could not ${description}: ${error.message}` +
            (busy ? '\n   Close Headlamp (or anything using the plugin folder) and try again.' : '')
        );
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200 * attempt);
    }
  }
}

function remove(target) {
  try {
    withRetry(() => fs.rmSync(target, { recursive: true, force: true }), `remove ${target}`);
  } catch (error) {
    fail(error.message);
  }
}

/** Other installed plugins that register themes, wherever Headlamp may load plugins from. */
function findThemePlugins(dirs) {
  const found = [];
  for (const dir of dirs) {
    const entries = fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === name || entry.name.startsWith('.')) continue;
      const main = path.join(dir, entry.name, 'main.js');
      if (fs.existsSync(main) && fs.readFileSync(main, 'utf8').includes(THEME_PLUGIN_MARKER)) {
        found.push(path.join(dir, entry.name));
      }
    }
  }
  return found;
}

const customDir = process.env.HEADLAMP_PLUGINS_DIR;
const pluginsDir = path.resolve(customDir || defaultPluginsDir());
const dest = path.join(pluginsDir, name);
if (!/^[a-z0-9][a-z0-9._-]*$/.test(name) || path.dirname(dest) !== pluginsDir) {
  fail(`Refusing to install: unexpected package name "${pkg.name}".`);
}
if (!fs.existsSync(path.join('node_modules', '@kinvolk', 'headlamp-plugin'))) {
  fail('Dependencies are missing; run "npm ci" (or "npm install") first.');
}

step('Bundling icons');
run('node scripts/build-icons.mjs');

if (!skipChecks) {
  step('Type-checking');
  run('npx headlamp-plugin tsc');
  step('Linting');
  run('npx headlamp-plugin lint');
  step('Running tests');
  run('npx headlamp-plugin test', { CI: 'true' });
}

step('Building');
remove('dist');
run('npx headlamp-plugin build');
const builtMain = path.join('dist', 'main.js');
if (!fs.existsSync(builtMain)) fail('Build did not produce dist/main.js.');

const { data, config } = headlampBaseDirs();
const searchDirs = [
  ...new Set([
    pluginsDir,
    ...(customDir
      ? []
      : [data, config].flatMap(base =>
          ['plugins', 'user-plugins'].map(dir => path.join(base, dir))
        )),
  ]),
];

// Only a plugin that registers themes itself can conflict with other theme plugins.
if (fs.readFileSync(builtMain, 'utf8').includes(THEME_PLUGIN_MARKER)) {
  const themePlugins = findThemePlugins(searchDirs);
  if (themePlugins.length > 0) {
    const message =
      `Other theme plugins are installed; they will fight ${name} over the active theme:\n` +
      themePlugins.map(dir => `   ${dir}`).join('\n') +
      '\n   Remove or disable them so only one theme plugin is active.';
    if (strict) fail(message);
    console.warn(`\n⚠️  ${message}`);
  }
}

step(`Installing into ${dest}`);
try {
  fs.mkdirSync(pluginsDir, { recursive: true });
  fs.accessSync(pluginsDir, fs.constants.W_OK);
} catch (error) {
  fail(`Plugins directory ${pluginsDir} is not writable: ${error.message}`);
}

// Only this plugin's own leftovers are cleaned; nothing else in the directory is touched.
for (const entry of fs.readdirSync(pluginsDir)) {
  if (TEMP_PREFIXES.some(prefix => entry.startsWith(prefix))) remove(path.join(pluginsDir, entry));
}

// Stage next to the destination and swap it in, so a running Headlamp never sees a
// half-copied plugin and files removed from the build do not linger.
// If the swap fails, the previous install is put back.
const [stagingPrefix, previousPrefix] = TEMP_PREFIXES;
const staging = path.join(pluginsDir, `${stagingPrefix}${process.pid}`);
const previous = path.join(pluginsDir, `${previousPrefix}${process.pid}`);
let installError;
try {
  fs.cpSync('dist', staging, { recursive: true });
  fs.copyFileSync('package.json', path.join(staging, 'package.json'));
  if (fs.existsSync(dest)) withRetry(() => fs.renameSync(dest, previous), `move aside ${dest}`);
  withRetry(() => fs.renameSync(staging, dest), `install into ${dest}`);
} catch (error) {
  installError = error;
  if (fs.existsSync(previous) && !fs.existsSync(dest)) fs.renameSync(previous, dest);
} finally {
  remove(staging);
  remove(previous);
}
if (installError) fail(installError.message);

const installed = JSON.parse(fs.readFileSync(path.join(dest, 'package.json'), 'utf8'));
if (installed.name !== pkg.name || installed.version !== pkg.version) {
  fail(`Installed package.json does not match (${installed.name} ${installed.version}).`);
}
for (const file of fs.readdirSync(dest)) {
  console.log(`  ${file} (${fs.statSync(path.join(dest, file)).size} bytes)`);
}

// A copy elsewhere (an older manual install in the other base directory, or a catalog install
// in user-plugins) may be the one Headlamp actually loads, hiding this build.
if (!customDir) {
  const otherCopies = searchDirs
    .map(dir => path.join(dir, name))
    .filter(copy => copy !== dest && fs.existsSync(copy));
  if (otherCopies.length > 0) {
    const message =
      `Other copies of ${name} exist; Headlamp may load one of them instead:\n` +
      otherCopies.map(copy => `   ${copy}`).join('\n') +
      '\n   Remove them so only the copy installed above is loaded.';
    if (strict) fail(message);
    console.warn(`\n⚠️  ${message}`);
  }
}

console.log(`\n✅ ${name} ${pkg.version} installed.`);
console.log('ℹ️  Reload Headlamp (Ctrl+Shift+R / Cmd+Shift+R) to load the new version.');
console.log(`   Settings > Plugins should then list ${name} ${pkg.version}.`);
