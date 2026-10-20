import { K8s } from '@kinvolk/headlamp-plugin/lib';
import React from 'react';
import {
  InstallStatus,
  K8S_APP_SELECTOR,
  OPERATOR_SELECTOR,
  PodJson,
  summarizeInstall,
} from '../api/ciliumInstall';

export interface InstallState {
  /** undefined while loading. */
  install?: InstallStatus;
  error: unknown;
}

interface PodObject {
  jsonData: PodJson;
}

/** Finds the Cilium component pods in any namespace and summarizes their health. */
export function useCiliumInstall(): InstallState {
  const Pod = K8s.ResourceClasses.Pod;
  const [apps, appsError] = Pod.useList({ labelSelector: K8S_APP_SELECTOR });
  const [operators, operatorsError] = Pod.useList({ labelSelector: OPERATOR_SELECTOR });
  const install = React.useMemo(() => {
    if (!apps && !operators) return undefined;
    const pods = [...((apps || []) as PodObject[]), ...((operators || []) as PodObject[])];
    return summarizeInstall(pods.map(p => p.jsonData));
  }, [apps, operators]);
  // Only report an error when nothing could be read at all.
  const error = !apps && !operators ? appsError || operatorsError : null;
  return { install, error };
}

/** Data of the cilium-config ConfigMap; null when it cannot be read, undefined while loading. */
export function useCiliumConfig(namespace: string): Record<string, string> | null | undefined {
  const [config, error] = K8s.ResourceClasses.ConfigMap.useGet('cilium-config', namespace);
  if (error) return null;
  if (!config) return undefined;
  return ((config as { jsonData: { data?: Record<string, string> } }).jsonData.data ||
    {}) as Record<string, string>;
}
