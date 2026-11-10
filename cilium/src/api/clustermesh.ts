/**
 * Cluster Mesh as far as the Kubernetes API shows it, without reading Secrets: the cluster's
 * identity in cilium-config, the clustermesh-apiserver and its Service, the clusters allowed to
 * connect (ConfigMap clustermesh-remote-users), the clusters the agents dial (host aliases of the
 * agent DaemonSet), global services (annotations), and the readiness the agents report as
 * Prometheus metrics. The cilium-clustermesh Secret is never read: it may hold etcd client keys.
 *
 * Names, limits and annotations follow Cilium 1.20 (pkg/clustermesh/types, pkg/annotation and the
 * Helm chart).
 */

// ---------------------------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------------------------

export const DEFAULT_CLUSTER_NAME = 'default';
/** Cilium's rule: up to 32 lower case alphanumerics and '-', alphanumeric at both ends. */
const NAME_PATTERN = /^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$/;

export interface MeshIdentity {
  name: string;
  id: number;
  /** 255 by default, 511 when set at installation. */
  maxConnected: number;
  /** Why the cluster cannot join a mesh as it is configured. */
  problems: string[];
}

export function meshIdentity(config: Record<string, string> = {}): MeshIdentity {
  const name = config['cluster-name'] || DEFAULT_CLUSTER_NAME;
  const id = Number(config['cluster-id'] || 0);
  const maxConnected = Number(config['max-connected-clusters'] || 255);
  const problems: string[] = [];
  if (!NAME_PATTERN.test(name)) {
    problems.push(
      `The cluster name "${name}" is invalid: up to 32 lower case letters, digits and '-', starting and ending with a letter or digit.`
    );
  }
  if (!Number.isInteger(id) || id <= 0) {
    problems.push(
      `No cluster ID is set: Cluster Mesh needs a unique ID from 1 to ${maxConnected}.`
    );
  } else if (id > maxConnected) {
    problems.push(`The cluster ID ${id} is above the limit of ${maxConnected}.`);
  }
  if (name === DEFAULT_CLUSTER_NAME) {
    problems.push(
      'The cluster still has the default name; every cluster in a mesh needs a unique name.'
    );
  }
  return { name, id: Number.isFinite(id) ? id : 0, maxConnected, problems };
}

/** Datapath mode: clusters in one mesh must all tunnel or all route natively. */
export function routingMode(config: Record<string, string> = {}): 'native' | 'tunnel' | undefined {
  const mode = config['routing-mode'] || config['tunnel'];
  if (!mode) return undefined;
  return mode === 'native' || mode === 'disabled' ? 'native' : 'tunnel';
}

export interface MeshSetting {
  label: string;
  value: string;
}

/** Cluster Mesh settings of cilium-config worth seeing at a glance. */
export function meshSettings(config: Record<string, string> = {}): MeshSetting[] {
  const settings: MeshSetting[] = [];
  const add = (label: string, key: string, format: (v: string) => string = v => v) => {
    if (config[key] !== undefined && config[key] !== '')
      settings.push({ label, value: format(config[key]) });
  };
  const onOff = (v: string) => (v === 'true' ? 'Enabled' : v === 'false' ? 'Disabled' : v);
  add('Maximum connected clusters', 'max-connected-clusters');
  add('EndpointSlice sync of global services', 'clustermesh-enable-endpoint-sync', onOff);
  add('MCS API', 'clustermesh-enable-mcs-api', onOff);
  add('Services global by default', 'clustermesh-default-global-namespace', onOff);
  add('Policies select the local cluster by default', 'policy-default-local-cluster', onOff);
  const native = config['ipv4-native-routing-cidr'];
  if (native) settings.push({ label: 'Native routing CIDR (IPv4)', value: native });
  return settings;
}

// ---------------------------------------------------------------------------------------------
// Clustermesh API server and the clusters around it
// ---------------------------------------------------------------------------------------------

export const APISERVER_SELECTOR = 'k8s-app=clustermesh-apiserver';
export const APISERVER_SERVICE = 'clustermesh-apiserver';
export const APISERVER_PORT = 2379;
export const MESH_DOMAIN = 'mesh.cilium.io';

export interface ServiceJson {
  metadata?: { name?: string; namespace?: string; annotations?: Record<string, string> };
  spec?: {
    type?: string;
    clusterIP?: string;
    ports?: Array<{ name?: string; port?: number; nodePort?: number }>;
  };
  status?: { loadBalancer?: { ingress?: Array<{ ip?: string; hostname?: string }> } };
}

export interface ApiserverAddress {
  type: string;
  /** Address other clusters can use, when the Service has one. */
  address?: string;
  port?: number;
  /** Why other clusters may not reach it. */
  note?: string;
}

/** How other clusters reach this cluster's clustermesh-apiserver. */
export function apiserverAddress(service: ServiceJson): ApiserverAddress {
  const type = service.spec?.type || 'ClusterIP';
  const port =
    service.spec?.ports?.find(p => p.port === APISERVER_PORT) || service.spec?.ports?.[0];
  if (type === 'LoadBalancer') {
    const ingress = service.status?.loadBalancer?.ingress?.[0];
    const address = ingress?.ip || ingress?.hostname;
    return address
      ? { type, address, port: port?.port }
      : { type, port: port?.port, note: 'The load balancer has no address yet.' };
  }
  if (type === 'NodePort') {
    return {
      type,
      port: port?.nodePort,
      note: 'Reachable on the node addresses at this port; remote clusters need them in their configuration.',
    };
  }
  return {
    type,
    address: service.spec?.clusterIP,
    port: port?.port,
    note: 'A ClusterIP Service is only reachable inside this cluster; use LoadBalancer or NodePort for a mesh.',
  };
}

/** Clusters allowed to connect to this one: users "remote-<cluster>" of clustermesh-remote-users. */
export function remoteUsers(usersYaml?: string): string[] {
  if (!usersYaml) return [];
  const names: string[] = [];
  for (const match of usersYaml.matchAll(/^\s*-\s*name:\s*["']?remote-([a-z0-9-]+)["']?\s*$/gm)) {
    names.push(match[1]);
  }
  return names;
}

export interface DaemonSetJson {
  spec?: {
    template?: { spec?: { hostAliases?: Array<{ ip?: string; hostnames?: string[] }> } };
  };
}

/**
 * Remote clusters the agents connect to directly, from the host aliases the Helm chart adds for
 * clusters configured with IPs (`<cluster>.mesh.cilium.io`). Absent when KVStoreMesh is used or the
 * clusters were configured by name.
 */
export function hostAliasClusters(
  daemonSet: DaemonSetJson | undefined,
  domain = MESH_DOMAIN
): Array<{ name: string; ips: string[] }> {
  const byName = new Map<string, string[]>();
  for (const alias of daemonSet?.spec?.template?.spec?.hostAliases || []) {
    for (const host of alias.hostnames || []) {
      if (!host.endsWith(`.${domain}`)) continue;
      const name = host.slice(0, -(domain.length + 1));
      const ips = byName.get(name) || [];
      if (alias.ip && !ips.includes(alias.ip)) ips.push(alias.ip);
      byName.set(name, ips);
    }
  }
  return [...byName.entries()].map(([name, ips]) => ({ name, ips }));
}

// ---------------------------------------------------------------------------------------------
// Global services
// ---------------------------------------------------------------------------------------------

export const ANNOTATIONS = {
  global: 'service.cilium.io/global',
  globalAlias: 'io.cilium/global-service',
  shared: 'service.cilium.io/shared',
  sharedAlias: 'io.cilium/shared-service',
  affinity: 'service.cilium.io/affinity',
  affinityAlias: 'io.cilium/service-affinity',
  syncEndpointSlices: 'service.cilium.io/global-sync-endpoint-slices',
} as const;

export type Affinity = 'none' | 'local' | 'remote';

export interface GlobalServiceSettings {
  global: boolean;
  /** Local endpoints are offered to other clusters (true unless set to false). */
  shared: boolean;
  affinity: Affinity;
  /** undefined: the cluster default (clustermesh-enable-endpoint-sync). */
  syncEndpointSlices?: boolean;
}

function flag(value?: string): boolean | undefined {
  if (value === undefined) return undefined;
  return value.toLowerCase() === 'true';
}

export function globalServiceSettings(
  annotations: Record<string, string> = {}
): GlobalServiceSettings {
  const global =
    flag(annotations[ANNOTATIONS.global] ?? annotations[ANNOTATIONS.globalAlias]) ?? false;
  const shared = flag(annotations[ANNOTATIONS.shared] ?? annotations[ANNOTATIONS.sharedAlias]);
  const affinity = (
    annotations[ANNOTATIONS.affinity] ??
    annotations[ANNOTATIONS.affinityAlias] ??
    'none'
  ).toLowerCase();
  return {
    global,
    shared: shared ?? global,
    affinity: affinity === 'local' || affinity === 'remote' ? affinity : 'none',
    syncEndpointSlices: flag(annotations[ANNOTATIONS.syncEndpointSlices]),
  };
}

/**
 * Merge patch of the annotations for the chosen settings. The alias annotations are removed so
 * the service is configured in one place; defaults are left out instead of written.
 */
export function globalServicePatch(settings: GlobalServiceSettings): {
  metadata: { annotations: Record<string, string | null> };
} {
  const annotations: Record<string, string | null> = {
    [ANNOTATIONS.globalAlias]: null,
    [ANNOTATIONS.sharedAlias]: null,
    [ANNOTATIONS.affinityAlias]: null,
    [ANNOTATIONS.global]: settings.global ? 'true' : null,
    [ANNOTATIONS.shared]: settings.global && !settings.shared ? 'false' : null,
    [ANNOTATIONS.affinity]:
      settings.global && settings.affinity !== 'none' ? settings.affinity : null,
    [ANNOTATIONS.syncEndpointSlices]:
      settings.global && settings.syncEndpointSlices !== undefined
        ? String(settings.syncEndpointSlices)
        : null,
  };
  return { metadata: { annotations } };
}

// ---------------------------------------------------------------------------------------------
// Connection status (agent metrics)
// ---------------------------------------------------------------------------------------------

export const STATUS_QUERIES = {
  /** Agents per remote cluster that report it ready, and all agents that know it. */
  ready: 'sum by (target_cluster) (cilium_clustermesh_remote_cluster_readiness_status)',
  agents: 'count by (target_cluster) (cilium_clustermesh_remote_cluster_readiness_status)',
  failures: 'sum by (target_cluster) (increase(cilium_clustermesh_remote_cluster_failures[1h]))',
  lastFailure: 'max by (target_cluster) (cilium_clustermesh_remote_cluster_last_failure_ts)',
};

export interface Sample {
  metric: Record<string, string>;
  value: [number, string];
}

export interface RemoteStatus {
  cluster: string;
  readyAgents: number;
  agents: number;
  failuresLastHour: number;
  /** ms since the epoch; undefined when it never failed. */
  lastFailure?: number;
}

/** One row per remote cluster from the agent metrics. */
export function remoteStatus(results: {
  ready: Sample[];
  agents: Sample[];
  failures: Sample[];
  lastFailure: Sample[];
}): RemoteStatus[] {
  const rows = new Map<string, RemoteStatus>();
  const row = (cluster: string) => {
    let r = rows.get(cluster);
    if (!r) rows.set(cluster, (r = { cluster, readyAgents: 0, agents: 0, failuresLastHour: 0 }));
    return r;
  };
  const each = (samples: Sample[], apply: (r: RemoteStatus, v: number) => void) => {
    for (const s of samples) {
      const cluster = s.metric.target_cluster;
      const v = Number(s.value?.[1]);
      if (cluster && Number.isFinite(v)) apply(row(cluster), v);
    }
  };
  each(results.ready, (r, v) => (r.readyAgents = v));
  each(results.agents, (r, v) => (r.agents = v));
  each(results.failures, (r, v) => (r.failuresLastHour = Math.round(v)));
  each(results.lastFailure, (r, v) => (r.lastFailure = v > 0 ? v * 1000 : undefined));
  return [...rows.values()].sort((a, b) => a.cluster.localeCompare(b.cluster));
}

// ---------------------------------------------------------------------------------------------
// Connecting two clusters
// ---------------------------------------------------------------------------------------------

/** Parses an IPv4 or IPv6 CIDR into a numeric range. */
export function parseCidr(cidr: string): { v6: boolean; start: bigint; end: bigint } | undefined {
  const [address, prefixText] = cidr.trim().split('/');
  const v6 = address.includes(':');
  const bits = v6 ? 128 : 32;
  const prefix = prefixText === undefined ? bits : Number(prefixText);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > bits) return undefined;
  let value = BigInt(0);
  if (v6) {
    const [head, tail] = address.split('::');
    const groups = (s?: string) => (s ? s.split(':') : []);
    const left = groups(head);
    const right = groups(tail);
    if (tail === undefined && left.length !== 8) return undefined;
    const all = [...left, ...Array(8 - left.length - right.length).fill('0'), ...right];
    for (const g of all) {
      if (!/^[0-9a-f]{1,4}$/i.test(g)) return undefined;
      value = (value << BigInt(16)) | BigInt(parseInt(g, 16));
    }
  } else {
    const octets = address.split('.');
    if (octets.length !== 4) return undefined;
    for (const o of octets) {
      const n = Number(o);
      if (!/^\d+$/.test(o) || n > 255) return undefined;
      value = (value << BigInt(8)) | BigInt(n);
    }
  }
  const hostBits = BigInt(bits - prefix);
  const start = (value >> hostBits) << hostBits;
  return { v6, start, end: start + (BigInt(1) << hostBits) - BigInt(1) };
}

/** Pairs of CIDRs from the two lists that share addresses. */
export function overlappingCidrs(a: string[], b: string[]): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  for (const x of a) {
    const rx = parseCidr(x);
    if (!rx) continue;
    for (const y of b) {
      const ry = parseCidr(y);
      if (ry && rx.v6 === ry.v6 && rx.start <= ry.end && ry.start <= rx.end) pairs.push([x, y]);
    }
  }
  return pairs;
}

/** What is known about one cluster for the connection check. */
export interface ClusterFacts {
  /** Headlamp's name of the cluster. */
  cluster: string;
  config?: Record<string, string>;
  version?: string;
  podCidrs: string[];
  apiserver?: ApiserverAddress;
  /** The clustermesh-apiserver pods are ready. */
  apiserverReady?: boolean;
}

export type CheckStatus = 'ok' | 'warning' | 'error' | 'unknown';

export interface MeshCheck {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
}

function minorOf(version?: string): [number, number] | undefined {
  const m = version?.match(/^v?(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2])] : undefined;
}

/** The documented prerequisites of Cluster Mesh, checked for two clusters. */
export function meshChecks(local: ClusterFacts, remote: ClusterFacts): MeshCheck[] {
  const checks: MeshCheck[] = [];
  const add = (id: string, label: string, status: CheckStatus, detail: string) =>
    checks.push({ id, label, status, detail });
  if (!local.config || !remote.config) {
    add(
      'config',
      'Cilium configuration',
      'unknown',
      `cilium-config of ${!local.config ? local.cluster : remote.cluster} could not be read.`
    );
    return checks;
  }
  const a = meshIdentity(local.config);
  const b = meshIdentity(remote.config);

  const identityProblems = [
    ...a.problems.map(p => `${local.cluster}: ${p}`),
    ...b.problems.map(p => `${remote.cluster}: ${p}`),
  ];
  add(
    'identity',
    'Cluster name and ID set',
    identityProblems.length ? 'error' : 'ok',
    identityProblems.length
      ? `${identityProblems.join(
          ' '
        )} Set them at installation (Helm cluster.name and cluster.id); changing them later needs all workloads restarted.`
      : `${a.name} (ID ${a.id}) and ${b.name} (ID ${b.id}).`
  );
  add(
    'unique',
    'Names and IDs differ',
    a.name === b.name || (a.id > 0 && a.id === b.id) ? 'error' : 'ok',
    a.name === b.name
      ? `Both clusters are named "${a.name}".`
      : a.id > 0 && a.id === b.id
      ? `Both clusters use the ID ${a.id}.`
      : 'Every cluster in a mesh needs its own name and ID.'
  );
  add(
    'maxConnected',
    'Same maximum of connected clusters',
    a.maxConnected === b.maxConnected ? 'ok' : 'error',
    a.maxConnected === b.maxConnected
      ? `${a.maxConnected} in both.`
      : `${local.cluster}: ${a.maxConnected}, ${remote.cluster}: ${b.maxConnected}. It can only be set at installation.`
  );

  const ra = routingMode(local.config);
  const rb = routingMode(remote.config);
  add(
    'routing',
    'Same datapath mode',
    !ra || !rb ? 'unknown' : ra === rb ? 'ok' : 'error',
    !ra || !rb
      ? 'The routing mode could not be read from cilium-config.'
      : ra === rb
      ? ra === 'native'
        ? 'Both route natively: the native routing CIDR of each cluster must cover the pod CIDRs of all clusters, and pods need IP connectivity between the clusters.'
        : 'Both use tunnelling.'
      : `${local.cluster} uses ${ra} routing, ${remote.cluster} ${rb}; all clusters must use the same mode.`
  );

  const overlaps = overlappingCidrs(local.podCidrs, remote.podCidrs);
  add(
    'podCidrs',
    'Pod CIDRs do not overlap',
    local.podCidrs.length === 0 || remote.podCidrs.length === 0
      ? 'unknown'
      : overlaps.length
      ? 'error'
      : 'ok',
    local.podCidrs.length === 0 || remote.podCidrs.length === 0
      ? 'The pod CIDRs could not be read (CiliumNode spec.ipam.podCIDRs).'
      : overlaps.length
      ? `Overlapping: ${overlaps.map(([x, y]) => `${x} ↔ ${y}`).join(', ')}.`
      : `${local.podCidrs.length} and ${remote.podCidrs.length} pod CIDRs, all distinct.`
  );

  const va = minorOf(local.version);
  const vb = minorOf(remote.version);
  const minorGap = va && vb ? Math.abs(va[0] * 100 + va[1] - (vb[0] * 100 + vb[1])) : undefined;
  add(
    'version',
    'Compatible Cilium versions',
    minorGap === undefined
      ? 'unknown'
      : minorGap === 0
      ? 'ok'
      : minorGap === 1
      ? 'warning'
      : 'error',
    minorGap === undefined
      ? 'The Cilium version of a cluster is unknown.'
      : minorGap === 0
      ? `Both run ${local.version}${
          local.version !== remote.version ? ` / ${remote.version}` : ''
        }.`
      : `${local.cluster} runs ${local.version}, ${remote.cluster} ${remote.version}; keep connected clusters within one minor version.`
  );

  for (const facts of [local, remote]) {
    const api = facts.apiserver;
    add(
      `apiserver-${facts.cluster}`,
      `Cluster Mesh API server in ${facts.cluster}`,
      !api
        ? 'warning'
        : facts.apiserverReady === false
        ? 'error'
        : api.note && api.type !== 'LoadBalancer'
        ? 'warning'
        : api.address || api.type === 'NodePort'
        ? 'ok'
        : 'warning',
      !api
        ? 'Not deployed yet: "cilium clustermesh enable" (or Helm clustermesh.useAPIServer=true) deploys it.'
        : facts.apiserverReady === false
        ? 'Deployed, but its pods are not ready.'
        : [
            `Service type ${api.type}`,
            api.address && `address ${api.address}${api.port ? `:${api.port}` : ''}`,
            api.note,
          ]
            .filter(Boolean)
            .join('; ') + '.'
    );
  }
  return checks;
}

/** Shell-safe kube context names. */
function quote(value: string): string {
  return /^[A-Za-z0-9_.:@/-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;
}

/** The documented cilium CLI steps to connect two clusters. */
export function connectCommands(
  localContext: string,
  remoteContext: string,
  serviceType: 'LoadBalancer' | 'NodePort',
  namespace = 'kube-system'
): string {
  const a = quote(localContext);
  const b = quote(remoteContext);
  const ns = quote(namespace);
  return [
    '# 1. Share the certificate authority (skip when both clusters already use the same cilium-ca).',
    `kubectl --context ${b} delete secret -n ${ns} cilium-ca --ignore-not-found`,
    `kubectl --context ${a} get secret -n ${ns} cilium-ca -o yaml | \\`,
    `  kubectl --context ${b} create -f -`,
    '',
    '# 2. Deploy the Cluster Mesh API server in both clusters.',
    `cilium clustermesh enable --context ${a} --service-type ${serviceType}`,
    `cilium clustermesh enable --context ${b} --service-type ${serviceType}`,
    `cilium clustermesh status --context ${a} --wait`,
    `cilium clustermesh status --context ${b} --wait`,
    '',
    '# 3. Connect them (one direction is enough; the connection works both ways).',
    `cilium clustermesh connect --context ${a} --destination-context ${b}`,
    `cilium clustermesh status --context ${a} --wait`,
  ].join('\n');
}

/** Helm values that connect `cluster` to `remote` (the chart's clustermesh.config). */
export function helmValues(
  cluster: { name: string; id: number },
  remote: { name: string; address?: string; port?: number },
  serviceType: 'LoadBalancer' | 'NodePort'
): string {
  return [
    'cluster:',
    `  name: ${cluster.name}`,
    `  id: ${cluster.id || '<unique 1-255>'}`,
    'clustermesh:',
    '  useAPIServer: true',
    '  apiserver:',
    '    service:',
    `      type: ${serviceType}`,
    '  config:',
    '    enabled: true',
    '    clusters:',
    `      - name: ${remote.name}`,
    `        address: ${remote.address || `<address of ${remote.name}'s clustermesh-apiserver>`}`,
    `        port: ${remote.port || APISERVER_PORT}`,
  ].join('\n');
}
