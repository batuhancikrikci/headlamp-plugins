/**
 * Pure helpers of the security dashboard. They read pod specs, namespace labels and cluster role
 * bindings only; Secrets are never read.
 */

export const SYSTEM_NAMESPACES = ['kube-system', 'kube-public', 'kube-node-lease'];

interface SecurityContext {
  privileged?: boolean;
  runAsNonRoot?: boolean;
  runAsUser?: number;
  allowPrivilegeEscalation?: boolean;
  capabilities?: { add?: string[] };
}

interface ContainerJson {
  name?: string;
  securityContext?: SecurityContext;
  resources?: { limits?: Record<string, string> };
}

export interface SecurityPodJson {
  metadata?: { name?: string; namespace?: string; ownerReferences?: Array<{ kind?: string }> };
  spec?: {
    hostNetwork?: boolean;
    hostPID?: boolean;
    hostIPC?: boolean;
    securityContext?: { runAsNonRoot?: boolean; runAsUser?: number };
    volumes?: Array<{ name?: string; hostPath?: { path?: string } }>;
    containers?: ContainerJson[];
    initContainers?: ContainerJson[];
  };
  status?: { phase?: string };
}

export type FindingKind =
  | 'privileged'
  | 'hostNamespaces'
  | 'hostPath'
  | 'capabilities'
  | 'root'
  | 'noMemoryLimit';

export const FINDINGS: Record<FindingKind, { label: string; level: 'error' | 'warning' }> = {
  privileged: { label: 'Privileged container', level: 'error' },
  hostNamespaces: { label: "Host's network, PID or IPC", level: 'error' },
  hostPath: { label: 'Host path volume', level: 'warning' },
  capabilities: { label: 'Powerful capabilities', level: 'warning' },
  root: { label: 'Runs as root', level: 'warning' },
  noMemoryLimit: { label: 'No memory limit', level: 'warning' },
};

/** Added capabilities that give (close to) host level access. */
const RISKY_CAPABILITIES = new Set([
  'ALL',
  'SYS_ADMIN',
  'NET_ADMIN',
  'SYS_PTRACE',
  'SYS_MODULE',
  'DAC_READ_SEARCH',
  'BPF',
]);

export interface Finding {
  kind: FindingKind;
  detail: string;
}

/** What weakens the isolation of a pod. "Runs as root" only when the spec says so (UID 0). */
export function podFindings(pod: SecurityPodJson): Finding[] {
  const spec = pod.spec ?? {};
  const findings: Finding[] = [];
  const containers = [...(spec.initContainers ?? []), ...(spec.containers ?? [])];
  const privileged = containers.filter(c => c.securityContext?.privileged).map(c => c.name);
  if (privileged.length > 0) {
    findings.push({ kind: 'privileged', detail: privileged.join(', ') });
  }
  const host = [spec.hostNetwork && 'network', spec.hostPID && 'PID', spec.hostIPC && 'IPC'].filter(
    Boolean
  );
  if (host.length > 0) findings.push({ kind: 'hostNamespaces', detail: host.join(', ') });
  const paths = (spec.volumes ?? []).filter(v => v.hostPath).map(v => v.hostPath?.path ?? '');
  if (paths.length > 0) findings.push({ kind: 'hostPath', detail: paths.join(', ') });
  const caps = containers.flatMap(c =>
    (c.securityContext?.capabilities?.add ?? [])
      .filter(cap => RISKY_CAPABILITIES.has(cap.toUpperCase().replace(/^CAP_/, '')))
      .map(cap => `${c.name}: ${cap}`)
  );
  if (caps.length > 0) findings.push({ kind: 'capabilities', detail: caps.join(', ') });
  const root = (spec.containers ?? [])
    .filter(c => (c.securityContext?.runAsUser ?? spec.securityContext?.runAsUser) === 0)
    .map(c => c.name);
  if (root.length > 0) findings.push({ kind: 'root', detail: `UID 0: ${root.join(', ')}` });
  const unlimited = (spec.containers ?? [])
    .filter(c => !c.resources?.limits?.memory)
    .map(c => c.name);
  if (unlimited.length > 0) findings.push({ kind: 'noMemoryLimit', detail: unlimited.join(', ') });
  return findings;
}

export interface PodFindings {
  namespace: string;
  name: string;
  findings: Finding[];
}

/** Pods with findings, outside the system namespaces unless asked. Finished pods are skipped. */
export function securityRows(pods: SecurityPodJson[], includeSystem: boolean): PodFindings[] {
  return pods
    .filter(p => includeSystem || !SYSTEM_NAMESPACES.includes(p.metadata?.namespace ?? ''))
    .filter(p => p.status?.phase !== 'Succeeded' && p.status?.phase !== 'Failed')
    .map(p => ({
      namespace: p.metadata?.namespace ?? '',
      name: p.metadata?.name ?? '',
      findings: podFindings(p),
    }))
    .filter(r => r.findings.length > 0)
    .sort((a, b) => `${a.namespace}/${a.name}`.localeCompare(`${b.namespace}/${b.name}`));
}

export function countByKind(rows: PodFindings[]): Record<FindingKind, number> {
  const counts = Object.fromEntries(Object.keys(FINDINGS).map(k => [k, 0])) as Record<
    FindingKind,
    number
  >;
  for (const row of rows) for (const f of row.findings) counts[f.kind] += 1;
  return counts;
}

export interface NamespaceJson {
  metadata?: { name?: string; labels?: Record<string, string> };
}

const PSS = 'pod-security.kubernetes.io/';

export interface PssRow {
  name: string;
  enforce?: string;
  warn?: string;
  audit?: string;
}

/** Pod Security Admission levels of each namespace (outside the system ones unless asked). */
export function podSecurityRows(namespaces: NamespaceJson[], includeSystem: boolean): PssRow[] {
  return namespaces
    .filter(ns => includeSystem || !SYSTEM_NAMESPACES.includes(ns.metadata?.name ?? ''))
    .map(ns => {
      const labels = ns.metadata?.labels ?? {};
      return {
        name: ns.metadata?.name ?? '',
        enforce: labels[`${PSS}enforce`],
        warn: labels[`${PSS}warn`],
        audit: labels[`${PSS}audit`],
      };
    })
    .sort(
      (a, b) =>
        Number(!!a.enforce && a.enforce !== 'privileged') -
          Number(!!b.enforce && b.enforce !== 'privileged') || a.name.localeCompare(b.name)
    );
}

export interface BindingJson {
  metadata?: { name?: string };
  roleRef?: { kind?: string; name?: string };
  subjects?: Array<{ kind?: string; name?: string; namespace?: string }>;
}

export interface AdminSubject {
  binding: string;
  kind: string;
  name: string;
  namespace?: string;
}

/** Subjects bound to cluster-admin, except the built-in system:masters group. */
export function clusterAdmins(bindings: BindingJson[]): AdminSubject[] {
  return bindings
    .filter(b => b.roleRef?.kind === 'ClusterRole' && b.roleRef.name === 'cluster-admin')
    .flatMap(b =>
      (b.subjects ?? [])
        .filter(s => !(s.kind === 'Group' && s.name === 'system:masters'))
        .map(s => ({
          binding: b.metadata?.name ?? '',
          kind: s.kind ?? '',
          name: s.name ?? '',
          namespace: s.namespace,
        }))
    )
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
}
