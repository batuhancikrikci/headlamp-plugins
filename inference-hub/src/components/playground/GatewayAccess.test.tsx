import { fireEvent, render, screen } from '@testing-library/react';
import { ChatTarget } from '../../api/openai';
import { requestHeaders, setHeaderRows } from '../../api/requestHeaders';
import { GatewayAccess } from './GatewayAccess';

// The lists of the cluster are the external dependency: the Gateway, its class and the
// SecurityPolicies. The class controller decides whether the policies apply.
const cluster = vi.hoisted(() => ({ controller: 'gateway.envoyproxy.io/gatewayclass-controller' }));
vi.mock('../../hooks/useLive', () => ({
  useResourceList: (id: string, opts: unknown) => ({
    items:
      opts === null
        ? []
        : id === 'gateways'
        ? [{ metadata: { name: 'ai-gateway', namespace: 'gw' }, spec: { gatewayClassName: 'gc' } }]
        : id === 'gatewayclasses'
        ? [{ metadata: { name: 'gc' }, spec: { controllerName: cluster.controller } }]
        : [
            {
              apiVersion: 'gateway.envoyproxy.io/v1alpha1',
              kind: 'SecurityPolicy',
              metadata: { name: 'keys', namespace: 'gw' },
              spec: {
                targetRefs: [{ kind: 'Gateway', name: 'ai-gateway' }],
                apiKeyAuth: { extractFrom: [{ headers: ['x-api-key'] }] },
              },
            },
          ],
  }),
}));

const target: ChatTarget = {
  id: 'gw/test',
  kind: 'Gateway',
  namespace: 'ai',
  name: 'qwen',
  defaultModel: 'qwen35-2b',
  gateway: {
    name: 'ai-gateway',
    namespace: 'gw',
    pathPrefix: '',
    source: 'agentRouter',
    routeName: 'models',
    routes: [{ name: 'models', namespace: 'gw' }],
    hostnames: ['llm.example.com'],
    endpointId: 'llm/ai/qwen',
  },
};

beforeEach(() => {
  setHeaderRows(target.id, []);
  cluster.controller = 'gateway.envoyproxy.io/gatewayclass-controller';
});

describe('GatewayAccess', () => {
  it('shows nothing for a target that is not behind a gateway', () => {
    const { container } = render(<GatewayAccess target={{ ...target, gateway: undefined }} />);
    expect(container.textContent).toBe('');
  });

  it('explains the route and its policy, and adds the header the policy reads', () => {
    render(<GatewayAccess target={target} />);
    expect(screen.getByText(/only accepts the hostnames llm.example.com/)).toBeTruthy();
    expect(screen.getByText('Gateway implementation: Envoy Gateway')).toBeTruthy();
    expect(
      screen.getByText(/Envoy Gateway SecurityPolicy gw\/keys: API key in header x-api-key/)
    ).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Add headers' }));
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: 'secret' } });
    expect(requestHeaders(target.id)).toEqual({ 'x-api-key': 'secret' });
    expect(screen.queryByRole('button', { name: 'Add headers' })).toBeNull();
  });

  it('does not apply Envoy Gateway policies to a gateway another implementation runs', () => {
    cluster.controller = 'istio.io/gateway-controller';
    render(<GatewayAccess target={target} />);
    expect(screen.getByText('Gateway implementation: Istio')).toBeTruthy();
    expect(screen.queryByText(/SecurityPolicy/)).toBeNull();
    expect(screen.getByText(/authentication policies of Istio are not read here/)).toBeTruthy();
  });

  it('refuses headers the Kubernetes API server reads itself', () => {
    render(<GatewayAccess target={target} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add header' }));
    fireEvent.change(screen.getByLabelText('Header'), { target: { value: 'Authorization' } });
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: 'Bearer x' } });
    expect(screen.getByText(/used to sign in to the Kubernetes API/)).toBeTruthy();
    expect(requestHeaders(target.id)).toEqual({});
  });
});
