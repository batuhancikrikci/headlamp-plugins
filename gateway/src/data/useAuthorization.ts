import { getCluster } from '@kinvolk/headlamp-plugin/lib/Utils';
import React from 'react';
import { classOf } from '../resources/classes';
import { KindName } from '../resources/registry';

export type AuthState = 'allowed' | 'denied' | 'unknown';

/**
 * Asks the API server (SelfSubjectAccessReview) whether the current user may perform `verb` on a
 * kind, optionally in one namespace. The answer is `unknown` while the check is running and when
 * it cannot be performed.
 */
export function useAuthorization(kind: KindName, verb: string, namespace?: string): AuthState {
  const [state, setState] = React.useState<AuthState>('unknown');
  const cluster = getCluster();

  React.useEffect(() => {
    let cancelled = false;
    setState('unknown');
    classOf(kind)
      .getAuthorization(verb, namespace ? { namespace } : {}, cluster ?? undefined)
      .then((result: { status?: { allowed?: boolean } } | undefined) => {
        if (cancelled) return;
        const allowed = result?.status?.allowed;
        setState(allowed === true ? 'allowed' : allowed === false ? 'denied' : 'unknown');
      })
      .catch(() => {
        if (!cancelled) setState('unknown');
      });
    return () => {
      cancelled = true;
    };
  }, [kind, verb, namespace, cluster]);

  return state;
}
