import { useTheme } from '@mui/material/styles';
import { useEffect } from 'react';
import { useStore } from 'react-redux';
import {
  HIDDEN_ATTR,
  PLUGIN_NAME,
  PLUGIN_THEMES,
  PRIMARY_VAR,
  THEME_DARK,
  THEME_LIGHT,
} from './config';
import { darkTheme, lightTheme } from './themes';

const THEME_STORAGE_KEY = 'headlampThemePreference';
/** Headlamp paints with this cached theme until plugins have registered theirs. */
const THEME_CACHE_KEY = 'cached-current-theme';
/** More corrections than this within the window means another plugin is fighting over the theme. */
const FUSE_LIMIT = 5;
const FUSE_WINDOW_MS = 2000;

const pluginThemeNames = new Set(PLUGIN_THEMES.map(name => name.toLowerCase()));

/** The plugin theme matching the OS/browser colour scheme. */
export function preferredTheme(): string {
  const prefersDark =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches;
  return prefersDark ? THEME_DARK : THEME_LIGHT;
}

/** Stores a plugin theme (the OS preference on first run) so the next start paints with it. */
export function persistTheme(): void {
  try {
    let name = localStorage.getItem(THEME_STORAGE_KEY) ?? '';
    if (!PLUGIN_THEMES.includes(name)) {
      name = preferredTheme();
      localStorage.setItem(THEME_STORAGE_KEY, name);
    }
    localStorage.setItem(
      THEME_CACHE_KEY,
      JSON.stringify(name === THEME_DARK ? darkTheme : lightTheme)
    );
  } catch {
    // Storage unavailable: the store guard still switches the theme.
  }
}

/** Theme cards in Settings are `role="button"` boxes labelled by their last child. */
function isPluginThemeCard(card: Element): boolean {
  const label = card.lastElementChild?.textContent?.trim().toLowerCase() ?? '';
  return pluginThemeNames.has(label);
}

/**
 * Hides every card except the plugin's in the Settings theme grid, so built-in themes and themes
 * of other plugins cannot be picked. Only grids that contain a plugin theme card are touched.
 */
export function hideForeignThemeCards(root: ParentNode = document): void {
  const grids = new Set<Element>();
  root.querySelectorAll('[role="button"]').forEach(card => {
    if (card.parentElement && isPluginThemeCard(card)) grids.add(card.parentElement);
  });
  grids.forEach(grid =>
    Array.from(grid.children).forEach(card => {
      if (card.getAttribute('role') === 'button' && !isPluginThemeCard(card)) {
        card.setAttribute(HIDDEN_ATTR, '');
      }
    })
  );
}

interface ThemeState {
  theme?: { name?: string };
}

interface ThemeStore {
  getState(): ThemeState;
  dispatch(action: { type: string; payload: unknown }): unknown;
}

/**
 * Returns a store listener that switches any non-plugin theme back to a plugin theme. A fuse stops
 * it when another plugin keeps switching the theme too, instead of looping forever.
 */
export function createThemeEnforcer(store: ThemeStore): () => void {
  let corrections: number[] = [];
  let blown = false;

  return () => {
    const name = store.getState().theme?.name;
    if (blown || name === undefined || PLUGIN_THEMES.includes(name)) return;

    const now = Date.now();
    corrections = corrections.filter(time => now - time < FUSE_WINDOW_MS);
    if (corrections.length >= FUSE_LIMIT) {
      blown = true;
      console.warn(
        `[${PLUGIN_NAME}] Another plugin keeps changing the theme; theme lock disabled for this session.`
      );
      return;
    }
    corrections.push(now);
    store.dispatch({ type: 'theme/setTheme', payload: preferredTheme() });
  };
}

/**
 * Renders nothing; registered as an app bar action so it runs inside Headlamp's store and MUI
 * theme. Keeps a plugin theme active and exposes the theme's colour scheme to global CSS.
 */
export function ThemeLock() {
  const store = useStore<ThemeState>();
  const { mode, primary } = useTheme().palette;

  useEffect(() => {
    const enforce = createThemeEnforcer(store);
    enforce();
    return store.subscribe(enforce);
  }, [store]);

  useEffect(() => {
    const root = document.documentElement;
    root.style.colorScheme = mode;
    root.style.setProperty(PRIMARY_VAR, primary.main);
  }, [mode, primary.main]);

  return null;
}
