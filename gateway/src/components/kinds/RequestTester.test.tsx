import { fireEvent, render, screen } from '@testing-library/react';
import { KubeJson } from '../../resources/types';
import { RequestTester } from './RequestTester';

// Headlamp components and object links only resolve inside Headlamp.
vi.mock('@kinvolk/headlamp-plugin/lib/CommonComponents', () => ({
  SectionBox: ({ title, children }: { title: string; children: React.ReactNode }) => (
    <section aria-label={title}>{children}</section>
  ),
}));
vi.mock('../common/RefLink', () => ({
  RefLink: ({ target, suffix }: { target: { kind: string; name: string }; suffix?: string }) => (
    <span>{`${target.kind}/${target.name}${suffix || ''}`}</span>
  ),
}));

const gateway = {
  apiVersion: 'gateway.networking.k8s.io/v1',
  kind: 'Gateway',
  metadata: { name: 'gw', namespace: 'infra' },
  spec: {
    listeners: [
      {
        name: 'web',
        protocol: 'HTTP',
        port: 80,
        hostname: 'shop.example.com',
        allowedRoutes: { namespaces: { from: 'All' } },
      },
    ],
  },
} as KubeJson;

const routes = [
  {
    apiVersion: 'gateway.networking.k8s.io/v1',
    kind: 'HTTPRoute',
    metadata: { name: 'shop', namespace: 'apps' },
    spec: {
      parentRefs: [{ name: 'gw', namespace: 'infra' }],
      rules: [
        { backendRefs: [{ name: 'web', port: 8080 }] },
        {
          matches: [
            {
              path: { type: 'PathPrefix', value: '/api' },
              queryParams: [{ name: 'v', value: '2' }],
            },
          ],
          backendRefs: [{ name: 'api-v2', port: 8080 }],
        },
      ],
    },
  },
] as KubeJson[];

describe('RequestTester', () => {
  it('shows the rule and backend that take the request as it is typed', () => {
    render(<RequestTester gateway={gateway} routes={routes} />);
    expect(screen.getByText('Service/web:8080')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Path'), { target: { value: '/api/users?v=2' } });
    expect(screen.getByText('Service/api-v2:8080')).toBeTruthy();
    expect((screen.getByLabelText('Path') as HTMLInputElement).value).toBe('/api/users');
    expect(screen.getByText('Also matching, with lower precedence')).toBeTruthy();
  });

  it('explains why no listener takes a host', () => {
    render(<RequestTester gateway={gateway} routes={routes} />);
    fireEvent.change(screen.getByLabelText('Host'), { target: { value: 'other.example.com' } });
    expect(screen.getByText(/No HTTP or HTTPS listener/)).toBeTruthy();
    expect(screen.getByText(/not used, hostname shop.example.com/)).toBeTruthy();
  });
});
