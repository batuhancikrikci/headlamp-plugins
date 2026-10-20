import { enforceLanguage } from './language';

describe('enforceLanguage', () => {
  const reload = vi.fn();
  const originalLocation = window.location;

  function setUrl(url: string): void {
    window.history.replaceState(null, '', url);
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, href: new URL(url, originalLocation.href).href, reload },
    });
  }

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    document.cookie = 'i18next=; Max-Age=0; path=/';
    reload.mockClear();
    setUrl('/c/prod/pods');
  });

  afterAll(() => {
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
  });

  it('does nothing when the language is already English', () => {
    localStorage.setItem('i18nextLng', 'en-US');

    expect(enforceLanguage()).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it('switches to English and reloads once', () => {
    localStorage.setItem('i18nextLng', 'tr');

    expect(enforceLanguage()).toBe(true);
    expect(localStorage.getItem('i18nextLng')).toBe('en');
    expect(reload).toHaveBeenCalledTimes(1);

    // Something forced the language back: no second reload in this session.
    localStorage.setItem('i18nextLng', 'tr');
    expect(enforceLanguage()).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('removes a ?lng= override from the URL', () => {
    localStorage.setItem('i18nextLng', 'en');
    setUrl('/c/prod/pods?lng=de&x=1#top');

    expect(enforceLanguage()).toBe(true);
    expect(window.history.state).toBeNull();
    expect(new URL(window.document.URL).search).toBe('?x=1');
    expect(new URL(window.document.URL).hash).toBe('#top');
  });

  it('removes a language cookie', () => {
    localStorage.setItem('i18nextLng', 'en');
    document.cookie = 'i18next=fr; path=/';

    expect(enforceLanguage()).toBe(true);
    expect(document.cookie).not.toContain('i18next=');
  });
});
