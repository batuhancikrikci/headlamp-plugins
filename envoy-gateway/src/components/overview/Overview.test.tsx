import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ObjectJson } from '../../resources/types';
import { Issue } from '../../utils/overview';
import { GatewayClassList, Header, IssueList } from './Overview';

// Headlamp's runtime is the external dependency: its classes and shared components are replaced
// by small stand-ins so the overview pieces can be rendered on their own.
vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  K8s: { ResourceClasses: {} },
  Router: { createRouteURL: (name: string) => `/c/test/${name}` },
  ApiProxy: { request: vi.fn() },
}));
vi.mock('@kinvolk/headlamp-plugin/lib/Utils', () => ({ getCluster: () => 'test' }));
vi.mock('@kinvolk/headlamp-plugin/lib/CommonComponents', () => ({
  AuthVisible: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Link: ({ children }: { children: React.ReactNode }) => <a href="#object">{children}</a>,
  Loader: () => null,
  StatusLabel: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  SectionBox: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
}));
// The resource classes extend Headlamp's KubeObject, which only resolves inside Headlamp.
vi.mock('../../resources/base', () => {
  class EnvoyGatewayObject {
    static useList() {
      return [[], null];
    }
  }
  return { EnvoyGatewayObject, PolicyObject: class extends EnvoyGatewayObject {} };
});
vi.mock('../common/form/EditActions', () => ({ SetupWizard: () => null }));

const issues: Issue[] = [
  { id: 'gw', severity: 'error', name: 'eg', message: 'The Gateway is not programmed.' },
  { id: 'proxy', severity: 'warning', name: 'proxy', message: 'The EnvoyProxy is unused.' },
];

function gateway(name: string, className: string, programmed: boolean): ObjectJson {
  return {
    apiVersion: 'gateway.networking.k8s.io/v1',
    kind: 'Gateway',
    metadata: { name, namespace: 'default' },
    spec: { gatewayClassName: className },
    status: { conditions: [{ type: 'Programmed', status: programmed ? 'True' : 'False' }] },
  } as ObjectJson;
}

function renderIn(node: React.ReactNode) {
  return render(<MemoryRouter>{node}</MemoryRouter>);
}

describe('Envoy Gateway overview', () => {
  it('counts errors and warnings in the header', () => {
    renderIn(<Header apiVersions={['v1alpha1']} issues={issues} installed />);
    expect(screen.getByText('1 error(s) · 1 warning(s)')).toBeTruthy();
  });

  it('lists the issues, or says nothing needs attention', () => {
    renderIn(<IssueList issues={issues} />);
    expect(screen.getByText('The Gateway is not programmed.')).toBeTruthy();
    expect(screen.getByText('The EnvoyProxy is unused.')).toBeTruthy();
    renderIn(<IssueList issues={[]} />);
    expect(screen.getByText('Nothing needs attention')).toBeTruthy();
  });

  it('shows how many Gateways of each class are programmed', () => {
    const classes = [
      { metadata: { name: 'eg' }, spec: { controllerName: 'gateway.envoyproxy.io' } },
    ] as ObjectJson[];
    renderIn(
      <GatewayClassList
        classes={classes}
        gateways={[gateway('a', 'eg', true), gateway('b', 'eg', false), gateway('c', 'x', true)]}
      />
    );
    expect(screen.getByText('1/2 Gateways programmed')).toBeTruthy();
  });
});
