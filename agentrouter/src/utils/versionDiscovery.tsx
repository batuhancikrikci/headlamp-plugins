import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { SectionBox } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { CircularProgress } from '@mui/material';
import React, { useEffect, useState } from 'react';
import { AIGatewayRoute } from '../resources/aiGatewayRoute';
import { AIServiceBackend } from '../resources/aiServiceBackend';
import { BackendSecurityPolicy } from '../resources/backendSecurityPolicy';
import { GatewayConfig } from '../resources/gatewayConfig';
import { MCPRoute } from '../resources/mcpRoute';
import { QuotaPolicy } from '../resources/quotaPolicy';

const API_GROUP = 'aigateway.envoyproxy.io';

/**
 * Type-safe interface for CRD classes that have a mutable apiVersion.
 * Avoids `any` while keeping the mutation surface explicit.
 */
interface CRDClassWithVersion {
  apiVersion: string;
}

/**
 * Maps each CRD's apiPlural to its class so we can patch apiVersion dynamically.
 */
const CRD_CLASSES: Record<string, CRDClassWithVersion> = {
  aigatewayroutes: AIGatewayRoute as unknown as CRDClassWithVersion,
  aiservicebackends: AIServiceBackend as unknown as CRDClassWithVersion,
  backendsecuritypolicies: BackendSecurityPolicy as unknown as CRDClassWithVersion,
  mcproutes: MCPRoute as unknown as CRDClassWithVersion,
  quotapolicies: QuotaPolicy as unknown as CRDClassWithVersion,
  gatewayconfigs: GatewayConfig as unknown as CRDClassWithVersion,
};

/** Stores the discovered API versions per resource, keyed by apiPlural. */
const discoveredVersions: Map<string, string> = new Map();

let discoveryDone = false;
/** Whether the aigateway.envoyproxy.io API group is served by the cluster (null until known). */
let groupAvailable: boolean | null = null;
let discoveryPromise: Promise<void> | null = null;

/**
 * Discovers the actual served API version for each CRD from the cluster
 * and patches the static apiVersion on the class.
 *
 * Uses a singleton promise to prevent duplicate network calls across
 * multiple component mounts. The discovered versions are cached in
 * `discoveredVersions` map for safety.
 */
async function discoverCRDVersions(): Promise<void> {
  if (discoveryDone) return;
  if (discoveryPromise) return discoveryPromise;

  discoveryPromise = (async () => {
    try {
      const groupInfo = await ApiProxy.request(`/apis/${API_GROUP}/`);
      if (!groupInfo?.versions) {
        groupAvailable = false;
        discoveryDone = true;
        return;
      }
      groupAvailable = true;

      const preferredVersion = groupInfo.preferredVersion?.groupVersion;
      const versions: string[] = groupInfo.versions
        .map((v: { groupVersion: string }) => v.groupVersion)
        .sort((a: string, b: string) => {
          if (a === preferredVersion) return -1;
          if (b === preferredVersion) return 1;
          return b.localeCompare(a);
        });

      for (const version of versions) {
        try {
          const versionInfo = await ApiProxy.request(`/apis/${version}/`);
          if (!versionInfo?.resources) continue;

          for (const resource of versionInfo.resources) {
            if (resource.name.includes('/')) continue;

            const cls = CRD_CLASSES[resource.name];
            if (cls && !discoveredVersions.has(resource.name)) {
              discoveredVersions.set(resource.name, version);
              (cls as CRDClassWithVersion).apiVersion = version;
            }
          }
        } catch {
          // Skip versions that fail (e.g. removed alpha versions)
        }
      }
    } catch {
      // If discovery fails entirely (e.g. 404 because the CRDs are not installed),
      // fall back to hardcoded defaults.
      groupAvailable = false;
    }
    discoveryDone = true;
  })();

  return discoveryPromise;
}

/** Returns whether the AI Gateway API group was found (null while discovery is pending). */
export function isAIGatewayGroupAvailable(): boolean | null {
  return groupAvailable;
}

/** Returns the served API version per CRD plural, as discovered from the cluster. */
export function getDiscoveredVersions(): ReadonlyMap<string, string> {
  return discoveredVersions;
}

/**
 * React hook that triggers version discovery and returns readiness state.
 */
export function useCRDVersionDiscovery() {
  const [ready, setReady] = useState(discoveryDone);

  useEffect(() => {
    if (discoveryDone) {
      setReady(true);
      return;
    }
    discoverCRDVersions().then(() => setReady(true));
  }, []);

  return ready;
}

/**
 * Wrapper component that waits for version discovery before rendering children.
 */
export function WithVersionDiscovery({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const ready = useCRDVersionDiscovery();

  if (!ready) {
    return (
      <SectionBox title={title}>
        <CircularProgress />
      </SectionBox>
    );
  }

  return <>{children}</>;
}
