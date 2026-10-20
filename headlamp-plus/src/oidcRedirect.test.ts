import {
  baseUrl,
  completeOidcReturn,
  installOidcRedirect,
  isOidcLoginUrl,
  RETURN_KEY,
} from './oidcRedirect';

const originalLocation = window.location;
const originalOpen = window.open;
const assign = vi.fn();
const replace = vi.fn();

function setLocation(url: string): void {
  const parsed = new URL(url);
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      href: parsed.href,
      origin: parsed.origin,
      pathname: parsed.pathname,
      search: parsed.search,
      assign,
      replace,
    },
  });
}

beforeEach(() => {
  assign.mockClear();
  replace.mockClear();
  sessionStorage.clear();
  localStorage.clear();
  window.history.replaceState(null, '');
  setLocation('https://headlamp.example.com/c/prod/login');
});

afterEach(() => {
  window.open = originalOpen;
  vi.restoreAllMocks();
});

afterAll(() => {
  Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
});

describe('isOidcLoginUrl', () => {
  it('matches Headlamp OIDC login URLs', () => {
    expect(isOidcLoginUrl('https://headlamp.example.com/oidc?dt=x&cluster=prod')).toBe(true);
    expect(isOidcLoginUrl('https://headlamp.example.com/base/oidc?cluster=prod')).toBe(true);
  });

  it('ignores other URLs', () => {
    expect(isOidcLoginUrl('https://github.com/issues/new')).toBe(false);
    expect(isOidcLoginUrl('https://headlamp.example.com/oidc')).toBe(false);
    expect(isOidcLoginUrl(undefined)).toBe(false);
  });
});

describe('installOidcRedirect', () => {
  it('opens the login in the current tab and remembers where to return', () => {
    window.open = vi.fn();
    window.history.replaceState({ key: 'k', state: { from: { pathname: '/c/prod/pods' } } }, '');
    installOidcRedirect();

    const result = window.open('https://headlamp.example.com/oidc?dt=x&cluster=prod', 'Login');

    expect(result).toBeNull();
    expect(assign).toHaveBeenCalledWith('https://headlamp.example.com/oidc?dt=x&cluster=prod');
    expect(JSON.parse(sessionStorage.getItem(RETURN_KEY)!).path).toBe('/c/prod/pods');
  });

  it('leaves other window.open calls alone', () => {
    const open = vi.fn();
    window.open = open;
    installOidcRedirect();

    window.open('https://github.com/issues/new', '_blank');

    expect(open).toHaveBeenCalledWith('https://github.com/issues/new', '_blank', undefined);
    expect(assign).not.toHaveBeenCalled();
  });

  it('is not active in the desktop app', () => {
    const open = vi.fn();
    window.open = open;
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 Headlamp Electron/33');
    installOidcRedirect();

    window.open('http://localhost:4466/oidc?cluster=prod', 'Login');

    expect(open).toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });
});

describe('baseUrl', () => {
  afterEach(() => {
    delete (window as Window & { headlampBaseUrl?: string }).headlampBaseUrl;
  });

  it.each([
    [undefined, ''],
    ['', ''],
    ['/', ''],
    ['.', ''],
    ['./', ''],
    ['/headlamp', '/headlamp'],
    ['/headlamp/', '/headlamp'],
    ['headlamp', '/headlamp'],
  ])('normalises %j to %j', (value, expected) => {
    (window as Window & { headlampBaseUrl?: string }).headlampBaseUrl = value;
    expect(baseUrl()).toBe(expected);
  });
});

describe('completeOidcReturn', () => {
  afterEach(() => {
    delete (window as Window & { headlampBaseUrl?: string }).headlampBaseUrl;
  });

  it('does not produce a double slash when the base URL is "/" (in-cluster default)', () => {
    (window as Window & { headlampBaseUrl?: string }).headlampBaseUrl = '/';
    setLocation('https://k8s.example.org/auth?cluster=k8stest');

    expect(completeOidcReturn()).toBe(true);
    expect(replace).toHaveBeenCalledWith('https://k8s.example.org/c/k8stest');
  });

  it('keeps a real base URL prefix', () => {
    (window as Window & { headlampBaseUrl?: string }).headlampBaseUrl = '/headlamp/';
    setLocation('https://example.com/headlamp/auth?cluster=prod');

    expect(completeOidcReturn()).toBe(true);
    expect(replace).toHaveBeenCalledWith('https://example.com/headlamp/c/prod');
  });

  it('continues to the remembered page after login', () => {
    sessionStorage.setItem(
      RETURN_KEY,
      JSON.stringify({ path: '/c/prod/pods', createdAt: Date.now() })
    );
    localStorage.setItem('auth_status', 'success');
    setLocation('https://headlamp.example.com/auth?cluster=prod');

    expect(completeOidcReturn()).toBe(true);
    expect(replace).toHaveBeenCalledWith('https://headlamp.example.com/c/prod/pods');
    expect(sessionStorage.getItem(RETURN_KEY)).toBeNull();
    expect(localStorage.getItem('auth_status')).toBeNull();
  });

  it('falls back to the cluster home when nothing (fresh) was remembered', () => {
    sessionStorage.setItem(
      RETURN_KEY,
      JSON.stringify({ path: '/c/prod/pods', createdAt: Date.now() - 60 * 60 * 1000 })
    );
    setLocation('https://headlamp.example.com/auth?cluster=prod');

    expect(completeOidcReturn()).toBe(true);
    expect(replace).toHaveBeenCalledWith('https://headlamp.example.com/c/prod');
  });

  it('does nothing outside the callback page or inside a popup', () => {
    expect(completeOidcReturn()).toBe(false);

    setLocation('https://headlamp.example.com/auth?cluster=prod');
    Object.defineProperty(window, 'opener', { configurable: true, value: {} });
    try {
      expect(completeOidcReturn()).toBe(false);
      expect(replace).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(window, 'opener', { configurable: true, value: null });
    }
  });
});
