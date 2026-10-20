import React from 'react';
import { AccessCheck, accessKey, checkAccess } from '../api/rbac';
import { useCurrentCluster } from './useCluster';

export interface CanState {
  /** undefined while checking. */
  allowed?: boolean;
  /** Explanation shown on disabled actions. */
  reason?: string;
}

/** Whether the current user may perform an action (SelfSubjectAccessReview). */
export function useCan(check: AccessCheck | null): CanState {
  const cluster = useCurrentCluster();
  const key = check ? accessKey(cluster, check) : '';
  const [state, setState] = React.useState<CanState>({});

  React.useEffect(() => {
    if (!check) {
      setState({ allowed: false });
      return;
    }
    let cancelled = false;
    setState({});
    checkAccess(cluster, check).then(result => {
      if (cancelled) return;
      setState({
        allowed: result.allowed,
        reason: result.allowed
          ? undefined
          : `You are not allowed to ${check.verb} ${check.resource}${
              check.namespace ? ` in namespace ${check.namespace}` : ''
            }.`,
      });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return state;
}
