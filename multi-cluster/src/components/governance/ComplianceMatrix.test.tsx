import { fireEvent, render, screen } from '@testing-library/react';
import { PolicyJson } from '../../resources/models/policy';
import { ComplianceMatrix } from './ComplianceMatrix';

// Links resolve Headlamp resource classes, which only exist inside Headlamp.
vi.mock('../common/ResourceRefLink', () => ({
  ClusterLink: ({ name }: { name: string }) => <span>{name}</span>,
  ResourceRefLink: ({ name, namespace }: { name: string; namespace?: string }) => (
    <span>{`${namespace}/${name}`}</span>
  ),
}));

const policy = (name: string, status: Array<[string, string]>): PolicyJson =>
  ({
    apiVersion: 'policy.open-cluster-management.io/v1',
    kind: 'Policy',
    metadata: { name, namespace: 'policies' },
    status: { status: status.map(([clustername, compliant]) => ({ clustername, compliant })) },
  } as PolicyJson);

const policies = [
  policy('cert-expiry', [
    ['east', 'Compliant'],
    ['west', 'Compliant'],
  ]),
  policy('no-privileged', [
    ['east', 'NonCompliant'],
    ['west', 'Compliant'],
  ]),
];

describe('ComplianceMatrix', () => {
  it('shows every policy on every cluster with an accessible status', () => {
    render(<ComplianceMatrix policies={policies} />);
    expect(screen.getByText('policies/cert-expiry')).toBeTruthy();
    expect(
      screen.getByRole('img', { name: 'policies/no-privileged · east: NonCompliant' })
    ).toBeTruthy();
    expect(screen.getAllByRole('img', { name: /: Compliant$/ })).toHaveLength(3);
  });

  it('can hide what is compliant', () => {
    render(<ComplianceMatrix policies={policies} />);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(screen.queryByText('policies/cert-expiry')).toBeNull();
    expect(screen.queryByText('west')).toBeNull();
    expect(screen.getByText('east')).toBeTruthy();
  });
});
