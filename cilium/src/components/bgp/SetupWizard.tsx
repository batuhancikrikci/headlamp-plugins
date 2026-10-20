import { getCluster } from '@kinvolk/headlamp-plugin/lib/Utils';
import { Alert, Box, Checkbox, FormControlLabel, FormGroup, Typography } from '@mui/material';
import React from 'react';
import { servedApiVersion } from '../../api/discovery';
import { TextInput } from '../../common/form/Fields';
import { SetupWizardDialog } from '../../common/form/SetupWizardDialog';
import { SummaryList } from '../../common/form/Wizard';
import { useText } from '../../common/i18n';
import { isValidResourceName } from '../../common/objects';
import {
  BGPAdvertisementEntry,
  BGPClusterInstance,
  BGPFamily,
  SERVICE_ADDRESS_TYPES,
  ServiceAddressType,
} from '../../resources/bgp';
import { crd } from '../../resources/registry';
import { KubeJson, LabelSelector } from '../../resources/types';
import { validateResource } from '../../utils/validation';
import { LabelSelectorEditor } from '../common/form/SelectorEditor';
import { MatchingNodes } from '../common/MatchingNodes';
import { NODE_LABEL_KEYS } from '../nodes/Forms';
import { InstanceEditor, PeerSessionFields } from './Forms';

/** Label key the wizard uses to connect the peer config to its advertisement. */
const ADVERTISE_KEY = 'advertise';

interface AdvertiseOptions {
  podCIDR: boolean;
  services: boolean;
  serviceAddresses: ServiceAddressType[];
  serviceSelector: LabelSelector;
  podIPPools: boolean;
}

interface Families {
  ipv4: boolean;
  ipv6: boolean;
}

function buildAdvertisements(options: AdvertiseOptions): BGPAdvertisementEntry[] {
  const entries: BGPAdvertisementEntry[] = [];
  if (options.podCIDR) entries.push({ advertisementType: 'PodCIDR' });
  if (options.services) {
    entries.push({
      advertisementType: 'Service',
      service: { addresses: options.serviceAddresses },
      selector: options.serviceSelector,
    });
  }
  if (options.podIPPools) entries.push({ advertisementType: 'CiliumPodIPPool', selector: {} });
  return entries;
}

function buildFamilies(families: Families, advertisementName: string): BGPFamily[] {
  const advertisements = { matchLabels: { [ADVERTISE_KEY]: advertisementName } };
  return [
    ...(families.ipv4 ? [{ afi: 'ipv4', safi: 'unicast', advertisements }] : []),
    ...(families.ipv6 ? [{ afi: 'ipv6', safi: 'unicast', advertisements }] : []),
  ];
}

function NameField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useText();
  return (
    <TextInput
      label={label}
      required
      value={value}
      onChange={v => onChange(v || '')}
      error={value && !isValidResourceName(value) ? t('Not a valid resource name') : undefined}
    />
  );
}

/**
 * Guided BGP setup: creates a CiliumBGPClusterConfig, the CiliumBGPPeerConfig its peers use and
 * the CiliumBGPAdvertisement that peer config selects, wired together by name and label.
 */
export function BGPSetupWizard({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useText();
  const cluster = getCluster();

  const [clusterName, setClusterName] = React.useState('bgp-cluster-config');
  const [peerConfigName, setPeerConfigName] = React.useState('bgp-peer-config');
  const [advertisementName, setAdvertisementName] = React.useState('bgp-advertisements');
  const [nodeSelector, setNodeSelector] = React.useState<LabelSelector | undefined>(undefined);
  const [instance, setInstance] = React.useState<BGPClusterInstance>({
    name: 'instance-65000',
    localASN: 65000,
    peers: [{ name: 'peer-1', peerAddress: '', peerASN: undefined }],
  });
  // Session settings are edited through the same fields as the peer config form.
  const [session, setSession] = React.useState<KubeJson>({
    apiVersion: '',
    kind: 'CiliumBGPPeerConfig',
    metadata: { name: '' },
    spec: {
      timers: { holdTimeSeconds: 90, keepAliveTimeSeconds: 30 },
      gracefulRestart: { enabled: true, restartTimeSeconds: 120 },
    },
  });
  const [families, setFamilies] = React.useState<Families>({ ipv4: true, ipv6: false });
  const [advertise, setAdvertise] = React.useState<AdvertiseOptions>({
    podCIDR: true,
    services: true,
    serviceAddresses: ['LoadBalancerIP'],
    serviceSelector: {},
    podIPPools: false,
  });

  const clusterConfig: KubeJson = React.useMemo(
    () => ({
      apiVersion: servedApiVersion(crd('CiliumBGPClusterConfig').plural, cluster),
      kind: 'CiliumBGPClusterConfig',
      metadata: { name: clusterName },
      spec: {
        ...(nodeSelector ? { nodeSelector } : {}),
        bgpInstances: [
          {
            ...instance,
            peers: (instance.peers || []).map(peer => ({
              ...peer,
              peerConfigRef: { name: peerConfigName },
            })),
          },
        ],
      },
    }),
    [cluster, clusterName, nodeSelector, instance, peerConfigName]
  );
  const peerConfig: KubeJson = React.useMemo(
    () => ({
      apiVersion: servedApiVersion(crd('CiliumBGPPeerConfig').plural, cluster),
      kind: 'CiliumBGPPeerConfig',
      metadata: { name: peerConfigName },
      spec: { ...session.spec, families: buildFamilies(families, advertisementName) },
    }),
    [cluster, peerConfigName, session, families, advertisementName]
  );
  const advertisement: KubeJson = React.useMemo(
    () => ({
      apiVersion: servedApiVersion(crd('CiliumBGPAdvertisement').plural, cluster),
      kind: 'CiliumBGPAdvertisement',
      metadata: { name: advertisementName, labels: { [ADVERTISE_KEY]: advertisementName } },
      spec: { advertisements: buildAdvertisements(advertise) },
    }),
    [cluster, advertisementName, advertise]
  );
  // Peer config and advertisement first, so the cluster config never references missing objects.
  const resources = [advertisement, peerConfig, clusterConfig];

  const toggleAddress = (address: ServiceAddressType, checked: boolean) =>
    setAdvertise(current => ({
      ...current,
      serviceAddresses: checked
        ? [...current.serviceAddresses, address]
        : current.serviceAddresses.filter(a => a !== address),
    }));
  const familyError = !families.ipv4 && !families.ipv6;

  return (
    <SetupWizardDialog
      open={open}
      onClose={onClose}
      title={t('BGP setup wizard')}
      resources={resources}
      summary={
        <SummaryList
          rows={[
            {
              label: t('Local ASN'),
              value: `${instance.localASN ?? '-'} (${instance.name})`,
            },
            {
              label: t('Peers'),
              value:
                (instance.peers || [])
                  .map(p => `${p.name}: ${p.peerAddress || '?'} (AS ${p.peerASN ?? '?'})`)
                  .join(' · ') || '-',
            },
            {
              label: t('Advertises'),
              value: buildAdvertisements(advertise)
                .map(a => a.advertisementType)
                .join(', '),
            },
          ]}
        />
      }
      steps={[
        {
          id: 'cluster',
          label: t('Cluster config'),
          description: t(
            'Which nodes speak BGP, with which local ASN, and to which peers (for example the top-of-rack routers).'
          ),
          errors: validateResource(clusterConfig),
          content: (
            <>
              <Box sx={{ maxWidth: 480, mb: 3 }}>
                <NameField
                  label={t('Cluster config name')}
                  value={clusterName}
                  onChange={setClusterName}
                />
              </Box>
              <LabelSelectorEditor
                label={t('Node selector')}
                optional
                value={nodeSelector}
                onChange={setNodeSelector}
                nilText={t('Not set: every node runs BGP.')}
                keySuggestions={NODE_LABEL_KEYS}
                emptyText={t('An empty selector matches every node.')}
              />
              <Box sx={{ mt: 1, mb: 3 }}>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  component="div"
                  sx={{ mb: 0.5 }}
                >
                  {t('Nodes that will run BGP:')}
                </Typography>
                <MatchingNodes selector={nodeSelector} />
              </Box>
              <InstanceEditor instance={instance} onChange={setInstance} hidePeerConfig />
            </>
          ),
        },
        {
          id: 'peer',
          label: t('Peer config'),
          description: t(
            'Session settings shared by all peers of this setup: timers, authentication and address families.'
          ),
          errors: [
            ...validateResource(peerConfig),
            ...(familyError ? [{ key: 'Select at least one address family' }] : []),
          ],
          content: (
            <>
              <Box sx={{ maxWidth: 480, mb: 3 }}>
                <NameField
                  label={t('Peer config name')}
                  value={peerConfigName}
                  onChange={setPeerConfigName}
                />
              </Box>
              <PeerSessionFields value={session} onChange={setSession} />
              <Typography variant="subtitle2" sx={{ mt: 3 }}>
                {t('Address families')}
              </Typography>
              <FormGroup row>
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={families.ipv4}
                      onChange={e => setFamilies({ ...families, ipv4: e.target.checked })}
                    />
                  }
                  label="IPv4 unicast"
                />
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={families.ipv6}
                      onChange={e => setFamilies({ ...families, ipv6: e.target.checked })}
                    />
                  }
                  label="IPv6 unicast"
                />
              </FormGroup>
            </>
          ),
        },
        {
          id: 'advertisements',
          label: t('Advertisements'),
          description: t('The prefixes Cilium announces to the peers.'),
          errors: validateResource(advertisement),
          content: (
            <>
              <Box sx={{ maxWidth: 480, mb: 2 }}>
                <NameField
                  label={t('Advertisement name')}
                  value={advertisementName}
                  onChange={setAdvertisementName}
                />
              </Box>
              <FormGroup>
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={advertise.podCIDR}
                      onChange={e => setAdvertise({ ...advertise, podCIDR: e.target.checked })}
                    />
                  }
                  label={t('Pod CIDRs of each node (makes pods routable from the network)')}
                />
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={advertise.services}
                      onChange={e => setAdvertise({ ...advertise, services: e.target.checked })}
                    />
                  }
                  label={t('Service addresses')}
                />
              </FormGroup>
              {advertise.services && (
                <Box sx={{ pl: 4, mb: 1 }}>
                  <FormGroup row>
                    {SERVICE_ADDRESS_TYPES.map(address => (
                      <FormControlLabel
                        key={address}
                        control={
                          <Checkbox
                            size="small"
                            checked={advertise.serviceAddresses.includes(address)}
                            onChange={e => toggleAddress(address, e.target.checked)}
                          />
                        }
                        label={address}
                      />
                    ))}
                  </FormGroup>
                  <LabelSelectorEditor
                    label={t('Service selector')}
                    value={advertise.serviceSelector}
                    onChange={v => setAdvertise({ ...advertise, serviceSelector: v || {} })}
                    emptyText={t('An empty selector advertises every service.')}
                  />
                </Box>
              )}
              <FormGroup>
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={advertise.podIPPools}
                      onChange={e => setAdvertise({ ...advertise, podIPPools: e.target.checked })}
                    />
                  }
                  label={t('Pod IP pools (multi-pool IPAM)')}
                />
              </FormGroup>
              <Alert severity="info" sx={{ mt: 2 }}>
                {t(
                  'The advertisement gets the label {{label}}, which the peer config selects for every address family.',
                  { label: `${ADVERTISE_KEY}=${advertisementName}` }
                )}
              </Alert>
            </>
          ),
        },
      ]}
    />
  );
}
