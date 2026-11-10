/**
 * Extra request headers for gateway targets (e.g. an API key a SecurityPolicy expects), per
 * target. They may be credentials, so they are kept in memory for the session only, never in
 * browser storage.
 */
import React from 'react';
import { headerProblem } from '../resources/gatewayTargets';

export interface HeaderRow {
  name: string;
  value: string;
}

const store = new Map<string, HeaderRow[]>();
const listeners = new Set<() => void>();

export function getHeaderRows(key: string): HeaderRow[] {
  return store.get(key) || [];
}

export function setHeaderRows(key: string, rows: HeaderRow[]) {
  store.set(key, rows);
  listeners.forEach(l => l());
}

/** The usable headers of a target, as sent with every request. */
export function requestHeaders(key?: string): Record<string, string> {
  if (!key) return {};
  const headers: Record<string, string> = {};
  for (const row of getHeaderRows(key)) {
    if (!headerProblem(row.name) && row.value) headers[row.name.trim()] = row.value;
  }
  return headers;
}

export function useHeaderRows(key: string): [HeaderRow[], (rows: HeaderRow[]) => void] {
  const [, render] = React.useReducer((x: number) => x + 1, 0);
  React.useEffect(() => {
    listeners.add(render);
    return () => {
      listeners.delete(render);
    };
  }, []);
  return [getHeaderRows(key), rows => setHeaderRows(key, rows)];
}
