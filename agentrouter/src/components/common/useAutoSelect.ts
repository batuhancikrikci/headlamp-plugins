import { useEffect, useRef } from 'react';

/**
 * Picks the only available option automatically, once per `scope` (e.g. per namespace),
 * when the field is still empty. Never overrides a user's choice.
 *
 * @param options loaded options, or null while loading
 * @param isEmpty whether the field currently has no value
 * @param select applies the chosen option
 * @param enabled set false to disable (e.g. when editing an existing object)
 * @param scope re-evaluates when it changes (e.g. the namespace)
 */
export function useAutoSelectSingle<T>(
  options: T[] | null,
  isEmpty: boolean,
  select: (option: T) => void,
  enabled = true,
  scope = ''
) {
  const decidedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!enabled || options === null || decidedFor.current === scope) return;
    decidedFor.current = scope;
    if (isEmpty && options.length === 1) select(options[0]);
    // select is intentionally not a dependency: it is recreated on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options, isEmpty, enabled, scope]);
}
