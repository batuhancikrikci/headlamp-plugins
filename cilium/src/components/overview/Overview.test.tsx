import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Header, IssueList } from './Overview';
import { Issue } from './overview';

// Headlamp's runtime is the external dependency: its classes and shared components are replaced
// by small stand-ins so the overview pieces can be rendered on their own.
vi.mock('@kinvolk/headlamp-plugin/lib', () => {
  class KubeObject {}
  return {
    K8s: { ResourceClasses: {}, cluster: { KubeObject } },
    Router: { createRouteURL: (name: string) => `/c/test/${name}` },
    ApiProxy: { request: vi.fn() },
  };
});
// The resource classes extend Headlamp's KubeObject, which only resolves inside Headlamp.
vi.mock('../../resources/base', () => ({
  CiliumObject: class {
    static useList() {
      return [[], null];
    }
  },
}));
vi.mock('../common/form/EditActions', () => ({ SetupWizard: () => null }));
vi.mock('@kinvolk/headlamp-plugin/lib/Utils', () => ({ getCluster: () => 'test' }));
vi.mock('@kinvolk/headlamp-plugin/lib/CommonComponents', () => ({
  AuthVisible: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Link: ({ children }: { children: React.ReactNode }) => <a href="#object">{children}</a>,
}));
vi.mock('@kinvolk/headlamp-plugin/lib/components/common/Resource/ResourceTable', () => ({
  default: () => null,
}));

const issues: Issue[] = [
  {
    id: 'pod',
    severity: 'error',
    kind: '',
    group: '',
    name: 'cilium-c',
    message: 'Not ready, restarted 4 times.',
  },
  {
    id: 'policy',
    severity: 'warning',
    kind: '',
    group: '',
    name: 'deny-all',
    message: 'The policy is not valid.',
  },
];

function renderIn(node: React.ReactNode) {
  return render(<MemoryRouter>{node}</MemoryRouter>);
}

describe('Cilium overview', () => {
  it('counts errors and warnings in the header', () => {
    renderIn(<Header install={undefined} issues={issues} />);
    expect(screen.getByText('1 error(s) · 1 warning(s)')).toBeTruthy();
  });

  it('says the installation is healthy without issues', () => {
    renderIn(<Header install={undefined} issues={[]} />);
    expect(screen.getByText('Healthy')).toBeTruthy();
    renderIn(<IssueList issues={[]} />);
    expect(screen.getByText('Nothing needs attention')).toBeTruthy();
  });

  it('lists every issue with its message', () => {
    renderIn(<IssueList issues={issues} />);
    expect(screen.getByText('cilium-c')).toBeTruthy();
    expect(screen.getByText('Not ready, restarted 4 times.')).toBeTruthy();
    expect(screen.getByText('The policy is not valid.')).toBeTruthy();
  });
});
