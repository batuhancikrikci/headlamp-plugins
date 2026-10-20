import { useCallback } from 'react';
import { useHistory, useLocation } from 'react-router-dom';

/**
 * Reads/writes a single URL query parameter so page state (tab, query, filters)
 * survives reloads and can be shared as a link.
 */
export function useQueryParam(name: string, defaultValue = ''): [string, (value: string) => void] {
  const location = useLocation();
  const history = useHistory();
  const value = new URLSearchParams(location.search).get(name) ?? defaultValue;

  const setValue = useCallback(
    (next: string) => {
      const params = new URLSearchParams(history.location.search);
      if (next === '' || next === defaultValue) params.delete(name);
      else params.set(name, next);
      const search = params.toString();
      history.replace({ ...history.location, search: search ? `?${search}` : '' });
    },
    [history, name, defaultValue]
  );

  return [value, setValue];
}
