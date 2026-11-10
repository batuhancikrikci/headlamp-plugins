import { fireEvent, render, screen } from '@testing-library/react';
import type { Availability } from '../../discovery/availability';
import type { KubeJson } from '../../resources/types';
import { FormProvider } from './form/FormContext';
import { WIZARDS } from './wizards';

// The object pickers and the cluster data load resources through Headlamp, which only exists
// inside Headlamp; the pickers become plain text, and the cluster has no objects.
vi.mock('../../data/GatewayApiData', () => ({
  useGatewayApiData: () => ({ json: () => null }),
}));
vi.mock('../../resources/classes', () => ({}));
vi.mock('./form/Pickers', () => {
  const Stub = ({ path }: { path?: string }) => <span>{path}</span>;
  return {
    WithNamespacedList: ({ children }: { children: (items: null) => React.ReactNode }) => (
      <>{children(null)}</>
    ),
    NamespaceInput: Stub,
    GatewayClassInput: Stub,
    ControllerNameInput: Stub,
    SecretNameInput: Stub,
    BackendRefFields: Stub,
    BackendKindFields: Stub,
    ListenerSetParentFields: Stub,
    ParentRefFields: Stub,
  };
});

const route: KubeJson = {
  apiVersion: 'gateway.networking.k8s.io/v1',
  kind: 'GRPCRoute',
  metadata: { name: 'cart', namespace: 'shop' },
  spec: {
    parentRefs: [{ name: 'gw' }],
    rules: [
      {
        matches: [{ method: { service: 'shop.v1.Cart', method: 'AddItem' } }],
        backendRefs: [{ name: 'cart', port: 50051 }],
      },
    ],
  },
};

function renderWizard(onReview = vi.fn()) {
  const Wizard = WIZARDS.GRPCRoute!;
  render(
    <FormProvider
      value={route}
      onChange={() => undefined}
      issues={[]}
      showAllErrors={false}
      mode="create"
      availability={{} as Availability}
    >
      <Wizard onReview={onReview} onRevealErrors={() => undefined} />
    </FormProvider>
  );
  return onReview;
}

describe('GRPCRoute wizard', () => {
  it('is offered next to the Gateway and HTTPRoute wizards', () => {
    expect(Object.keys(WIZARDS).sort()).toEqual(['GRPCRoute', 'Gateway', 'HTTPRoute']);
  });

  it('walks parents, hostnames, methods, filters and backends', () => {
    renderWizard();
    for (const step of ['Parents', 'Hostnames', 'Methods', 'Filters', 'Backends']) {
      expect(screen.getAllByText(step).length).toBeGreaterThan(0);
    }
  });

  it('summarizes the gRPC methods of each rule', () => {
    renderWizard();
    fireEvent.click(screen.getAllByText('Backends')[0]);
    expect(screen.getAllByText(/shop\.v1\.Cart\/AddItem/).length).toBeGreaterThan(0);
  });
});
