import {
  ANNOTATIONS,
  apiserverAddress,
  ClusterFacts,
  connectCommands,
  EMPTY_MANUAL_CLUSTER,
  globalServicePatch,
  globalServiceSettings,
  helmValues,
  hostAliasClusters,
  invalidCidrs,
  manualFacts,
  manualFromFacts,
  meshChecks,
  meshIdentity,
  overlappingCidrs,
  parseCidr,
  remoteStatus,
  remoteUsers,
  routingMode,
} from './clustermesh';

describe('meshIdentity', () => {
  it('accepts a named cluster with an ID', () => {
    expect(meshIdentity({ 'cluster-name': 'east', 'cluster-id': '2' })).toEqual({
      name: 'east',
      id: 2,
      maxConnected: 255,
      problems: [],
    });
  });

  it('explains what keeps a cluster out of a mesh', () => {
    expect(meshIdentity({}).problems).toEqual([
      'No cluster ID is set: Cluster Mesh needs a unique ID from 1 to 255.',
      'The cluster still has the default name; every cluster in a mesh needs a unique name.',
    ]);
    expect(meshIdentity({ 'cluster-name': 'East_1', 'cluster-id': '300' }).problems).toHaveLength(
      2
    );
    expect(
      meshIdentity({ 'cluster-name': 'x', 'cluster-id': '300', 'max-connected-clusters': '511' })
        .problems
    ).toEqual([]);
    expect(
      meshIdentity({ 'cluster-name': 'a'.repeat(33), 'cluster-id': '1' }).problems
    ).toHaveLength(1);
  });

  it('reads the datapath mode', () => {
    expect(routingMode({ 'routing-mode': 'native' })).toBe('native');
    expect(routingMode({ 'routing-mode': 'tunnel' })).toBe('tunnel');
    expect(routingMode({ tunnel: 'vxlan' })).toBe('tunnel');
    expect(routingMode({})).toBeUndefined();
  });
});

describe('API server and remote clusters', () => {
  it('finds the address other clusters use', () => {
    expect(
      apiserverAddress({
        spec: { type: 'LoadBalancer', ports: [{ port: 2379 }] },
        status: { loadBalancer: { ingress: [{ ip: '192.0.2.10' }] } },
      })
    ).toEqual({ type: 'LoadBalancer', address: '192.0.2.10', port: 2379 });
    expect(
      apiserverAddress({ spec: { type: 'NodePort', ports: [{ port: 2379, nodePort: 32379 }] } })
    ).toMatchObject({ type: 'NodePort', port: 32379 });
    expect(
      apiserverAddress({ spec: { clusterIP: '10.0.0.5', ports: [{ port: 2379 }] } }).note
    ).toMatch(/only reachable inside/);
  });

  it('reads the clusters allowed to connect', () => {
    expect(
      remoteUsers(
        'users:\n- name: remote-west\n  role: remote\n- name: "remote-north"\n  role: remote\n'
      )
    ).toEqual(['west', 'north']);
    expect(remoteUsers(undefined)).toEqual([]);
  });

  it('reads the clusters the agents dial from host aliases', () => {
    expect(
      hostAliasClusters({
        spec: {
          template: {
            spec: {
              hostAliases: [
                { ip: '192.0.2.1', hostnames: ['west.mesh.cilium.io'] },
                { ip: '192.0.2.2', hostnames: ['west.mesh.cilium.io'] },
                { ip: '10.0.0.1', hostnames: ['registry.local'] },
              ],
            },
          },
        },
      })
    ).toEqual([{ name: 'west', ips: ['192.0.2.1', '192.0.2.2'] }]);
  });

  it('builds one status row per remote cluster', () => {
    const s = (cluster: string, value: string) => ({
      metric: { target_cluster: cluster },
      value: [0, value] as [number, string],
    });
    expect(
      remoteStatus({
        ready: [s('west', '2')],
        agents: [s('west', '3')],
        failures: [s('west', '4.2')],
        lastFailure: [s('west', '1700000000')],
      })
    ).toEqual([
      {
        cluster: 'west',
        readyAgents: 2,
        agents: 3,
        failuresLastHour: 4,
        lastFailure: 1_700_000_000_000,
      },
    ]);
  });
});

describe('global services', () => {
  it('reads the annotations and their aliases', () => {
    expect(globalServiceSettings({})).toEqual({
      global: false,
      shared: false,
      affinity: 'none',
      syncEndpointSlices: undefined,
    });
    expect(
      globalServiceSettings({ [ANNOTATIONS.globalAlias]: 'true', [ANNOTATIONS.affinity]: 'Local' })
    ).toMatchObject({ global: true, shared: true, affinity: 'local' });
    expect(
      globalServiceSettings({ [ANNOTATIONS.global]: 'true', [ANNOTATIONS.shared]: 'false' }).shared
    ).toBe(false);
  });

  it('writes only what differs from the defaults and drops the aliases', () => {
    expect(
      globalServicePatch({
        global: true,
        shared: false,
        affinity: 'remote',
        syncEndpointSlices: true,
      }).metadata.annotations
    ).toEqual({
      [ANNOTATIONS.globalAlias]: null,
      [ANNOTATIONS.sharedAlias]: null,
      [ANNOTATIONS.affinityAlias]: null,
      [ANNOTATIONS.global]: 'true',
      [ANNOTATIONS.shared]: 'false',
      [ANNOTATIONS.affinity]: 'remote',
      [ANNOTATIONS.syncEndpointSlices]: 'true',
    });
    const off = globalServicePatch({ global: false, shared: false, affinity: 'local' }).metadata
      .annotations;
    expect(Object.values(off).every(v => v === null)).toBe(true);
  });
});

describe('CIDRs', () => {
  it('parses IPv4 and IPv6', () => {
    expect(parseCidr('10.0.0.0/8')).toMatchObject({ v6: false });
    expect(parseCidr('fd00::/104')).toMatchObject({ v6: true });
    expect(parseCidr('10.0.0.300/8')).toBeUndefined();
    expect(parseCidr('10.0.0.0/40')).toBeUndefined();
  });

  it('finds overlapping ranges of the same family', () => {
    expect(overlappingCidrs(['10.0.0.0/16'], ['10.0.128.0/24', '10.1.0.0/16'])).toEqual([
      ['10.0.0.0/16', '10.0.128.0/24'],
    ]);
    expect(overlappingCidrs(['fd00:10::/64'], ['fd00:10::/96', '10.0.0.0/8'])).toEqual([
      ['fd00:10::/64', 'fd00:10::/96'],
    ]);
    expect(overlappingCidrs(['10.0.0.0/24'], ['10.0.1.0/24'])).toEqual([]);
  });
});

describe('meshChecks', () => {
  const facts = (
    cluster: string,
    config: Record<string, string>,
    extra: Partial<ClusterFacts> = {}
  ): ClusterFacts => ({
    cluster,
    config,
    version: 'v1.20.4',
    podCidrs: [],
    ...extra,
  });

  it('passes two well prepared clusters', () => {
    const api = { type: 'LoadBalancer', address: '192.0.2.10', port: 2379 };
    const checks = meshChecks(
      facts(
        'east',
        { 'cluster-name': 'east', 'cluster-id': '1', 'routing-mode': 'tunnel' },
        { podCidrs: ['10.1.0.0/16'], apiserver: api, apiserverReady: true }
      ),
      facts(
        'west',
        { 'cluster-name': 'west', 'cluster-id': '2', 'routing-mode': 'tunnel' },
        { podCidrs: ['10.2.0.0/16'], apiserver: api, apiserverReady: true }
      )
    );
    expect(checks.filter(c => c.status !== 'ok')).toEqual([]);
  });

  it('reports clashes and mismatches', () => {
    const checks = meshChecks(
      facts(
        'east',
        { 'cluster-name': 'prod', 'cluster-id': '1', 'routing-mode': 'native' },
        { podCidrs: ['10.0.0.0/16'] }
      ),
      facts(
        'west',
        {
          'cluster-name': 'prod',
          'cluster-id': '1',
          'routing-mode': 'tunnel',
          'max-connected-clusters': '511',
        },
        { podCidrs: ['10.0.0.0/16'], version: 'v1.18.0' }
      )
    );
    const status = Object.fromEntries(checks.map(c => [c.id, c.status]));
    expect(status).toMatchObject({
      unique: 'error',
      maxConnected: 'error',
      routing: 'error',
      podCidrs: 'error',
      version: 'error',
      'apiserver-east': 'warning',
    });
  });

  it('stops when a configuration is missing', () => {
    expect(meshChecks({ cluster: 'a', podCidrs: [] }, facts('b', {}))).toEqual([
      expect.objectContaining({ id: 'config', status: 'unknown' }),
    ]);
  });
});

describe('connect output', () => {
  it('gives the documented CLI steps with quoted contexts', () => {
    const commands = connectCommands('east', 'kind west', 'LoadBalancer');
    expect(commands).toContain(
      'cilium clustermesh enable --context east --service-type LoadBalancer'
    );
    expect(commands).toContain(
      "cilium clustermesh connect --context east --destination-context 'kind west'"
    );
    expect(commands).toContain(
      'kubectl --context east get secret -n kube-system cilium-ca -o yaml'
    );
  });

  it('gives Helm values for one side', () => {
    expect(
      helmValues(
        { name: 'east', id: 1 },
        { name: 'west', address: '192.0.2.10', port: 2379 },
        'NodePort'
      )
    ).toBe(
      [
        'cluster:',
        '  name: east',
        '  id: 1',
        'clustermesh:',
        '  useAPIServer: true',
        '  apiserver:',
        '    service:',
        '      type: NodePort',
        '  config:',
        '    enabled: true',
        '    clusters:',
        '      - name: west',
        '        address: 192.0.2.10',
        '        port: 2379',
      ].join('\n')
    );
  });
});

describe('a cluster entered by hand', () => {
  const local: ClusterFacts = {
    cluster: 'east',
    config: { 'cluster-name': 'east', 'cluster-id': '1', 'routing-mode': 'tunnel' },
    version: 'v1.20.4',
    podCidrs: ['10.0.0.0/16'],
    apiserver: { type: 'LoadBalancer', address: '192.0.2.1', port: 2379 },
    apiserverReady: true,
  };

  it('is checked like a read cluster', () => {
    const remote = manualFacts({
      ...EMPTY_MANUAL_CLUSTER,
      name: 'west',
      id: '2',
      routing: 'tunnel',
      version: 'v1.20.2',
      podCidrs: '10.1.0.0/16,\n10.2.0.0/16',
      address: '198.51.100.7',
    });
    expect(remote.podCidrs).toEqual(['10.1.0.0/16', '10.2.0.0/16']);
    expect(remote.apiserver).toMatchObject({ address: '198.51.100.7', port: 2379 });
    const status = Object.fromEntries(meshChecks(local, remote).map(c => [c.id, c.status]));
    expect(status).toMatchObject({
      identity: 'ok',
      unique: 'ok',
      maxConnected: 'ok',
      routing: 'ok',
      podCidrs: 'ok',
      version: 'ok',
      'apiserver-east': 'ok',
      'apiserver-west': 'unknown',
    });
  });

  it('leaves what was not entered unchecked and still finds conflicts', () => {
    const remote = manualFacts({ ...EMPTY_MANUAL_CLUSTER, name: 'east', id: '1' });
    const checks = meshChecks(local, remote);
    const status = Object.fromEntries(checks.map(c => [c.id, c.status]));
    expect(status).toMatchObject({ unique: 'error', routing: 'unknown', podCidrs: 'unknown' });
    expect(checks.find(c => c.id === 'routing')?.detail).toContain('east');
  });

  it('reports entries that are not CIDRs', () => {
    expect(invalidCidrs('10.0.0.0/16, 10.1.0.0, fd00::/64')).toEqual(['10.1.0.0']);
  });
});

describe('manualFromFacts', () => {
  it('takes the entry values from a read cluster', () => {
    expect(
      manualFromFacts({
        cluster: 'east',
        config: { 'cluster-name': 'east', 'cluster-id': '3', tunnel: 'vxlan' },
        version: 'v1.20.4',
        podCidrs: ['10.0.0.0/24', '10.0.1.0/24'],
        apiserver: { type: 'LoadBalancer', address: '192.0.2.1', port: 2379 },
      })
    ).toEqual({
      name: 'east',
      id: '3',
      maxConnected: '255',
      routing: 'tunnel',
      version: 'v1.20.4',
      podCidrs: '10.0.0.0/24\n10.0.1.0/24',
      address: '192.0.2.1',
      port: '2379',
    });
  });

  it('leaves out a ClusterIP address other clusters cannot use', () => {
    const entry = manualFromFacts({
      cluster: 'east',
      config: {},
      podCidrs: [],
      apiserver: { type: 'ClusterIP', address: '10.96.0.5', port: 2379 },
    });
    expect(entry.address).toBe('');
  });
});
