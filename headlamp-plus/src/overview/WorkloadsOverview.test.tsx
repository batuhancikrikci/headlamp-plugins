import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// Plain JSON standing in for Kubernetes objects, and the KubeObject-like wrapper around it.
interface FixtureJson {
  metadata: { name: string; namespace?: string; uid?: string; [key: string]: unknown };
  [key: string]: unknown;
}
interface Fixture {
  jsonData: FixtureJson;
  metadata: FixtureJson['metadata'];
}
type SelectorState = { filter: { namespaces: Set<string> } };

// Headlamp's runtime (cluster data, shared components) is the external dependency here; it is
// replaced by fixtures so the page can be rendered on its own.
const data = vi.hoisted(() => ({
  object: (json: FixtureJson): Fixture => ({ jsonData: json, metadata: json.metadata }),
  lists: {} as Record<string, [Fixture[] | null, unknown]>,
  namespaces: new Set<string>(),
  table: null as Fixture[] | null,
}));

vi.mock('@kinvolk/headlamp-plugin/lib', () => {
  const cls = (kind: string) => ({ useList: () => data.lists[kind] ?? [[], null] });
  const kinds = [
    'Pod',
    'Deployment',
    'StatefulSet',
    'DaemonSet',
    'ReplicaSet',
    'Job',
    'CronJob',
    'JobSet',
  ];
  return {
    K8s: { ResourceClasses: Object.fromEntries(kinds.map(kind => [kind, cls(kind)])) },
    Router: { createRouteURL: (name: string) => `/c/k8stest/${name}` },
  };
});
vi.mock('@kinvolk/headlamp-plugin/lib/CommonComponents', () => ({
  Link: ({ kubeObject }: { kubeObject: Fixture }) => (
    <a href="#object">{kubeObject.metadata.name}</a>
  ),
  ResourceListView: ({ title, data: rows }: { title: string; data: Fixture[] | null }) => {
    data.table = rows;
    return <section aria-label={`${title} table`} />;
  },
}));
vi.mock('@kinvolk/headlamp-plugin/lib/Utils', () => ({
  getReadyReplicas: () => 0,
  getTotalReplicas: () => 0,
}));
vi.mock('react-redux', () => ({
  useSelector: (selector: (state: SelectorState) => unknown) =>
    selector({ filter: { namespaces: data.namespaces } }),
}));

import { WorkloadsOverview } from './WorkloadsOverview';

const workload = (name: string, namespace: string, desired: number, ready: number) =>
  data.object({
    metadata: { name, namespace, uid: `${namespace}/${name}` },
    spec: { replicas: desired },
    status: { readyReplicas: ready },
  });
const job = (name: string, conditions: { type: string; status: string; reason?: string }[]) =>
  data.object({
    metadata: { name, namespace: 'data', uid: `job-${name}` },
    status: { conditions },
  });

function renderPage() {
  return render(
    <MemoryRouter>
      <WorkloadsOverview />
    </MemoryRouter>
  );
}

beforeEach(() => {
  data.namespaces = new Set();
  data.table = null;
  data.lists = {
    Pod: [
      [
        data.object({
          metadata: { name: 'web-1', namespace: 'shop', uid: 'p1' },
          status: { phase: 'Running' },
        }),
      ],
      null,
    ],
    Deployment: [[workload('web', 'shop', 3, 3), workload('checkout', 'shop', 2, 1)], null],
    StatefulSet: [[workload('postgres', 'data', 3, 3)], null],
    Job: [
      [
        job('import', [{ type: 'Complete', status: 'True' }]),
        job('export', [{ type: 'Failed', status: 'True', reason: 'BackoffLimitExceeded' }]),
      ],
      null,
    ],
    CronJob: [
      [
        data.object({
          metadata: { name: 'nightly', namespace: 'data', uid: 'c1' },
          spec: { suspend: true },
        }),
      ],
      null,
    ],
    // The JobSet CRD is not installed.
    JobSet: [null, { status: 404 }],
  };
});

describe('WorkloadsOverview', () => {
  it('summarises every kind and lists what needs attention', () => {
    renderPage();

    expect(screen.getByRole('heading', { level: 1, name: 'Workloads' })).toBeTruthy();
    expect(screen.getByText('1 error · 1 warning')).toBeTruthy();
    expect(screen.getByText('2/3')).toBeTruthy(); // workloads ready
    expect(screen.getByText('7/8')).toBeTruthy(); // replicas
    expect(screen.getByText('Not all replicas are ready')).toBeTruthy();
    expect(screen.getByText('Job failed (BackoffLimitExceeded)')).toBeTruthy();
    expect(screen.getByText('1/2 ready')).toBeTruthy(); // deployments
    expect(screen.getByText('1/2 healthy')).toBeTruthy(); // jobs
    expect(screen.getByText('0/1 active')).toBeTruthy(); // cron jobs
    expect(screen.getAllByText('1 suspended').length).toBe(2); // KPI tile and kind row
    // A kind whose API is missing is left out; the table still gets every loaded workload.
    expect(screen.queryByText('Job Sets')).toBeNull();
    expect(data.table?.map(item => item.metadata.name)).toEqual([
      'web',
      'checkout',
      'postgres',
      'import',
      'export',
      'nightly',
    ]);
  });

  it('shows what has loaded while slower lists are still pending', () => {
    data.lists.Pod = [null, null];
    data.lists.StatefulSet = [null, null];
    // A JobSet API that never answers must not hold anything back.
    data.lists.JobSet = [null, null];
    renderPage();

    // Issues found so far are listed, with a note about what is still loading.
    expect(screen.getByText('Not all replicas are ready')).toBeTruthy();
    expect(screen.getByText('Still loading Pods, Stateful Sets…')).toBeTruthy();
    expect(screen.getByText('1 error · 1 warning')).toBeTruthy();
    // Tiles that need the missing lists wait; the table already has the loaded workloads.
    expect(screen.getAllByText('Loading…').length).toBe(2);
    expect(data.table?.map(item => item.metadata.name)).toEqual([
      'web',
      'checkout',
      'import',
      'export',
      'nightly',
    ]);
  });

  it('follows the namespace filter', () => {
    data.namespaces = new Set(['data']);
    renderPage();

    expect(screen.getByText('1 error')).toBeTruthy(); // only the failed job
    expect(screen.getByText('1/1')).toBeTruthy(); // workloads ready: postgres only
    expect(screen.queryByText('Not all replicas are ready')).toBeNull();
    // The table filters by namespace itself, so it still receives everything.
    expect(data.table?.length).toBe(6);
  });
});
