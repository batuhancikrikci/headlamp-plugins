import { LOCKED_LANGUAGE, PLUGIN_NAME } from './config';

// i18next-browser-languagedetector looks up the query string, then the cookie, then
// localStorage (which it also caches to), then the browser language.
const QUERY_PARAM = 'lng';
const COOKIE_NAME = 'i18next';
const STORAGE_KEY = 'i18nextLng';
const RELOAD_FLAG = `${PLUGIN_NAME}-language-reloaded`;

function isLocked(language: string | null | undefined): boolean {
  return (language ?? '').toLowerCase().split('-')[0] === LOCKED_LANGUAGE;
}

function readCookie(): string | undefined {
  const prefix = `${COOKIE_NAME}=`;
  const cookie = document.cookie.split('; ').find(entry => entry.startsWith(prefix));
  return cookie === undefined ? undefined : decodeURIComponent(cookie.slice(prefix.length));
}

/**
 * Removes every language source the detector prefers over localStorage and pins localStorage to
 * the locked language. Returns true when the language detected before pinning was not the locked one.
 */
function pinLanguage(): boolean {
  const url = new URL(window.location.href);
  const fromQuery = url.searchParams.get(QUERY_PARAM);
  if (fromQuery !== null) {
    url.searchParams.delete(QUERY_PARAM);
    window.history.replaceState(window.history.state, '', url.href);
  }

  const fromCookie = readCookie();
  if (fromCookie !== undefined) document.cookie = `${COOKIE_NAME}=; Max-Age=0; path=/`;

  const fromStorage = localStorage.getItem(STORAGE_KEY);
  if (!isLocked(fromStorage)) localStorage.setItem(STORAGE_KEY, LOCKED_LANGUAGE);

  return !isLocked(fromQuery ?? fromCookie ?? fromStorage ?? navigator.language);
}

/**
 * Locks the UI language. Headlamp's i18next instance is not exposed to plugins, so the language
 * is pinned where the detector reads it and the page is reloaded, at most once per session so a
 * source that keeps forcing another language cannot cause a reload loop. Safe to call often; it
 * also catches language changes after start-up. Returns true when reloading.
 */
export function enforceLanguage(): boolean {
  try {
    if (!pinLanguage()) {
      sessionStorage.removeItem(RELOAD_FLAG);
      return false;
    }
    if (sessionStorage.getItem(RELOAD_FLAG)) return false;
    sessionStorage.setItem(RELOAD_FLAG, '1');
    window.location.reload();
    return true;
  } catch {
    return false;
  }
}
