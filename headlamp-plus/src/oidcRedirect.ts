/**
 * Web only: OIDC sign-in in the same tab instead of Headlamp's popup window.
 *
 * Headlamp opens `<app url>oidc?...&cluster=<name>` with window.open; the backend redirects to
 * the identity provider (Dex) and, after login, back to `/auth?cluster=<name>`, where the popup
 * normally signals the opener through localStorage. Here the login URL is opened in the current
 * tab and, back on `/auth`, the user is sent to the page the login screen was guarding.
 */

export const RETURN_KEY = 'headlamp-plus-oidc-return';
const RETURN_TTL_MS = 15 * 60 * 1000;

interface PendingLogin {
  path: string;
  createdAt: number;
}

type HeadlampWindow = Window & {
  process?: { type?: string };
  desktopApi?: unknown;
  headlampBaseUrl?: string;
};

function safely<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

/** Same checks as Headlamp's isElectron(), plus the desktop app's preload API. */
export function isDesktopApp(): boolean {
  const win = window as HeadlampWindow;
  return (
    win.process?.type === 'renderer' ||
    win.desktopApi !== undefined ||
    navigator.userAgent.includes('Electron')
  );
}

export function isOidcLoginUrl(url: string | URL | undefined): boolean {
  if (!url) return false;
  const parsed = safely(() => new URL(String(url), window.location.href));
  return !!parsed && parsed.pathname.endsWith('/oidc') && parsed.searchParams.has('cluster');
}

/**
 * Headlamp's base URL without a trailing slash, normalised like getBaseUrl(): in-cluster
 * deployments usually set "/" (or "./"), which means no prefix at all.
 */
export function baseUrl(): string {
  const raw = (window as HeadlampWindow).headlampBaseUrl ?? '';
  const trimmed = raw.replace(/^\.(?=\/|$)/, '').replace(/\/+$/, '');
  return trimmed && !trimmed.startsWith('/') ? `/${trimmed}` : trimmed;
}

function clusterHome(cluster: string): string {
  return `/c/${encodeURIComponent(cluster)}`;
}

/** The page the login screen was guarding (react-router's `from` state), else the cluster home. */
function returnPath(cluster: string): string {
  type RouterState = { state?: { from?: { pathname?: string; search?: string } } } | null;
  const from = (window.history.state as RouterState)?.state?.from;
  return from?.pathname?.startsWith('/')
    ? `${from.pathname}${from.search ?? ''}`
    : clusterHome(cluster);
}

/** Routes Headlamp's OIDC popup into the current tab. */
export function installOidcRedirect(): void {
  if (isDesktopApp()) return;
  const open = window.open.bind(window);
  window.open = (url?: string | URL, target?: string, features?: string) => {
    if (!isOidcLoginUrl(url)) return open(url, target, features);

    const cluster = new URL(String(url), window.location.href).searchParams.get('cluster') ?? '';
    const pending: PendingLogin = { path: returnPath(cluster), createdAt: Date.now() };
    safely(() => sessionStorage.setItem(RETURN_KEY, JSON.stringify(pending)));
    window.location.assign(String(url));
    return null;
  };
}

/**
 * On Headlamp's `/auth` callback page in the main tab, continues to the page the user wanted
 * (or the cluster home). Returns true when navigating away.
 */
export function completeOidcReturn(): boolean {
  if (isDesktopApp() || window.opener) return false;

  const { pathname, search, origin } = window.location;
  const cluster = new URLSearchParams(search).get('cluster');
  if (!pathname.endsWith('/auth') || !cluster) return false;

  const pending = safely(() => {
    const raw = sessionStorage.getItem(RETURN_KEY);
    sessionStorage.removeItem(RETURN_KEY);
    // Only the popup flow reads this flag; do not leave it behind.
    localStorage.removeItem('auth_status');
    return raw ? (JSON.parse(raw) as PendingLogin) : undefined;
  });
  const isFresh =
    !!pending?.path?.startsWith('/') && Date.now() - pending.createdAt <= RETURN_TTL_MS;
  const path = (isFresh ? pending!.path : clusterHome(cluster)).replace(/^\/+/, '/');

  window.location.replace(`${origin}${baseUrl()}${path}`);
  return true;
}
