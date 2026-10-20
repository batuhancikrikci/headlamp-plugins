import { HIDDEN_ATTR, THEME_DARK, THEME_LIGHT } from './config';
import { createThemeEnforcer, hideForeignThemeCards, persistTheme } from './themeLock';

// Mirrors Settings > Theme: role="button" cards whose last child is the capitalized name.
function renderThemeGrid(names: string[]): void {
  document.body.innerHTML = `<div id="grid">${names
    .map(name => `<div role="button"><div class="preview"></div><div>${name}</div></div>`)
    .join('')}</div>`;
}

function visibleCards(): string[] {
  return Array.from(document.querySelectorAll(`#grid > :not([${HIDDEN_ATTR}])`)).map(
    el => el.lastElementChild!.textContent!
  );
}

function mockColorScheme(dark: boolean): void {
  window.matchMedia = vi.fn().mockReturnValue({ matches: dark }) as typeof window.matchMedia;
}

describe('hideForeignThemeCards', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('keeps only the plugin themes', () => {
    renderThemeGrid([
      'Light',
      'Dark',
      'Headlamp classic',
      'Lights out',
      'Some plugin theme',
      'Headlamp plus light',
      'Headlamp plus dark',
    ]);
    hideForeignThemeCards();

    expect(visibleCards()).toEqual(['Headlamp plus light', 'Headlamp plus dark']);
  });

  it('leaves grids without a plugin theme alone', () => {
    renderThemeGrid(['Light', 'Dark']);
    hideForeignThemeCards();

    expect(document.querySelector(`[${HIDDEN_ATTR}]`)).toBeNull();
  });
});

describe('persistTheme', () => {
  beforeEach(() => localStorage.clear());

  it('replaces a built-in theme with the plugin theme matching the OS preference', () => {
    mockColorScheme(true);
    localStorage.setItem('headlampThemePreference', 'light');
    persistTheme();

    expect(localStorage.getItem('headlampThemePreference')).toBe(THEME_DARK);
    expect(JSON.parse(localStorage.getItem('cached-current-theme')!).name).toBe(THEME_DARK);
  });

  it('keeps a plugin theme the user picked', () => {
    mockColorScheme(true);
    localStorage.setItem('headlampThemePreference', THEME_LIGHT);
    persistTheme();

    expect(localStorage.getItem('headlampThemePreference')).toBe(THEME_LIGHT);
  });
});

describe('createThemeEnforcer', () => {
  function fakeStore(name: string) {
    const state = { theme: { name } };
    return {
      state,
      getState: () => state,
      dispatch: vi.fn((action: { payload: unknown }) => {
        state.theme.name = action.payload as string;
      }),
    };
  }

  it('switches a built-in theme to a plugin theme', () => {
    mockColorScheme(false);
    const store = fakeStore('dark');
    createThemeEnforcer(store)();

    expect(store.dispatch).toHaveBeenCalledWith({ type: 'theme/setTheme', payload: THEME_LIGHT });
  });

  it('leaves plugin themes alone', () => {
    const store = fakeStore(THEME_DARK);
    createThemeEnforcer(store)();

    expect(store.dispatch).not.toHaveBeenCalled();
  });

  it('gives up instead of looping when another plugin keeps switching the theme', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const store = fakeStore('other');
    const enforce = createThemeEnforcer(store);
    for (let i = 0; i < 20; i++) {
      store.state.theme.name = 'other';
      enforce();
    }

    expect(store.dispatch).toHaveBeenCalledTimes(5);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
