import { Box, Typography } from '@mui/material';
import React from 'react';
import {
  ArrayEditor,
  FieldGrid,
  FormSection,
  NumberInput,
  SelectInput,
  StringListInput,
  SwitchInput,
  TextInput,
  useBinder,
} from '../../common/form/Fields';
import { ResourceFormProps } from '../../common/form/ResourceEditor';
import { useText } from '../../common/i18n';
import { setIn } from '../../common/objects';
import {
  AdvertisementType,
  BGPAdvertisementEntry,
  BGPClusterInstance,
  BGPClusterPeer,
  BGPFamily,
  BGPNodeOverrideInstance,
  SERVICE_ADDRESS_TYPES,
} from '../../resources/bgp';
import { crd } from '../../resources/registry';
import { KubeJson } from '../../resources/types';
import { isValidIP } from '../../utils/cidr';
import {
  KeyValueEditor,
  LabelSelectorEditor,
  MetadataFields,
  NameAutocomplete,
} from '../common/form/SelectorEditor';
import { coreClass } from '../common/ResourceRefLink';
import { NODE_LABEL_KEYS } from '../nodes/Forms';
import { withField } from '../policies/RuleEditor';

const MAX_ASN = 4294967295;

function ipError(value: string | undefined, message: string): string | undefined {
  return value && !isValidIP(value) ? message : undefined;
}

/** Editor for one peer of a BGP instance. */
export function PeerEditor({
  peer,
  onChange,
  hidePeerConfig,
}: {
  peer: BGPClusterPeer;
  onChange: (next: BGPClusterPeer) => void;
  /** The setup wizard wires the peer config itself. */
  hidePeerConfig?: boolean;
}) {
  const { t } = useText();
  return (
    <FieldGrid columns={hidePeerConfig ? 3 : 2}>
      <TextInput
        label={t('Peer name')}
        required
        placeholder="tor-switch-1"
        value={peer.name}
        onChange={v => onChange({ ...peer, name: v || '' })}
      />
      <TextInput
        label={t('Peer address')}
        required={!peer.autoDiscovery}
        placeholder="10.0.0.1"
        value={peer.peerAddress}
        error={ipError(peer.peerAddress, t('Not a valid IP address'))}
        onChange={v => onChange(withField(peer, 'peerAddress', v))}
        helperText={peer.autoDiscovery ? t('Auto-discovery is configured in YAML') : undefined}
      />
      <NumberInput
        label={t('Peer ASN')}
        min={1}
        max={MAX_ASN}
        placeholder="65001"
        value={peer.peerASN}
        onChange={v => onChange(withField(peer, 'peerASN', v))}
      />
      {!hidePeerConfig && (
        <NameAutocomplete
          cls={crd('CiliumBGPPeerConfig').cls}
          label={t('Peer config')}
          value={peer.peerConfigRef?.name}
          onChange={v =>
            onChange(
              withField(peer, 'peerConfigRef', v ? { ...peer.peerConfigRef, name: v } : undefined)
            )
          }
          helperText={t('Timers, authentication and address families; defaults apply when empty')}
        />
      )}
    </FieldGrid>
  );
}

/** Editor for one BGP instance (local ASN and its peers). */
export function InstanceEditor({
  instance,
  onChange,
  hidePeerConfig,
}: {
  instance: BGPClusterInstance;
  onChange: (next: BGPClusterInstance) => void;
  hidePeerConfig?: boolean;
}) {
  const { t } = useText();
  return (
    <Box>
      <FieldGrid columns={3}>
        <TextInput
          label={t('Instance name')}
          required
          value={instance.name}
          onChange={v => onChange({ ...instance, name: v || '' })}
        />
        <NumberInput
          label={t('Local ASN')}
          min={1}
          max={MAX_ASN}
          value={instance.localASN}
          onChange={v => onChange(withField(instance, 'localASN', v))}
          help={t('Private ASNs: 64512–65534 (2-byte) and 4200000000–4294967294 (4-byte).')}
        />
        <NumberInput
          label={t('Local port')}
          min={1}
          max={65535}
          placeholder="179"
          value={instance.localPort}
          onChange={v => onChange(withField(instance, 'localPort', v))}
          help={t('Leave empty unless peers must connect to the node; Cilium then listens here.')}
        />
      </FieldGrid>
      <Typography variant="subtitle2" sx={{ mt: 2, mb: 1 }}>
        {t('Peers')}
      </Typography>
      <ArrayEditor<BGPClusterPeer>
        items={instance.peers}
        onChange={peers => onChange(withField(instance, 'peers', peers))}
        newItem={() => ({ name: '', peerAddress: '', peerASN: undefined })}
        addLabel={t('Add peer')}
        itemTitle={(peer, i) => peer.name || t('Peer #{{index}}', { index: i + 1 })}
        emptyText={t('No peers yet.')}
        renderItem={(peer, update) => (
          <PeerEditor peer={peer} onChange={update} hidePeerConfig={hidePeerConfig} />
        )}
      />
    </Box>
  );
}

export function BGPClusterConfigForm({ value, onChange, mode }: ResourceFormProps) {
  const { t } = useText();
  const bind = useBinder<KubeJson>(value, onChange);
  const instances = bind<BGPClusterInstance[]>(['spec', 'bgpInstances']);
  return (
    <>
      <FormSection title={t('General')} icon="mdi:tag-outline">
        <MetadataFields value={value} onChange={onChange} mode={mode} />
      </FormSection>
      <FormSection
        title={t('Nodes')}
        description={t('The nodes that run these BGP instances.')}
        icon="mdi:server"
      >
        <LabelSelectorEditor
          label={t('Node selector')}
          optional
          nilText={t('Not set: the configuration applies to every node.')}
          emptyText={t('An empty selector matches every node.')}
          keySuggestions={NODE_LABEL_KEYS}
          {...bind(['spec', 'nodeSelector'])}
        />
      </FormSection>
      <FormSection title={t('BGP instances')} icon="mdi:router-network">
        <ArrayEditor<BGPClusterInstance>
          items={instances.value}
          onChange={instances.onChange}
          newItem={() => ({ name: '', localASN: undefined, peers: [] })}
          addLabel={t('Add instance')}
          itemTitle={(instance, i) => instance.name || t('Instance #{{index}}', { index: i + 1 })}
          minItems={1}
          renderItem={(instance, update) => (
            <InstanceEditor instance={instance} onChange={update} />
          )}
        />
      </FormSection>
    </>
  );
}

const AFIS = ['ipv4', 'ipv6', 'l2vpn'];
const SAFIS = ['unicast', 'multicast', 'evpn', 'mpls_label', 'mpls_vpn'];

function FamilyEditor({
  family,
  onChange,
}: {
  family: BGPFamily;
  onChange: (next: BGPFamily) => void;
}) {
  const { t } = useText();
  return (
    <Box>
      <FieldGrid>
        <SelectInput
          label="AFI"
          allowEmpty={false}
          options={AFIS}
          value={family.afi}
          onChange={v => onChange({ ...family, afi: v || 'ipv4' })}
        />
        <SelectInput
          label="SAFI"
          allowEmpty={false}
          options={SAFIS}
          value={family.safi}
          onChange={v => onChange({ ...family, safi: v || 'unicast' })}
        />
      </FieldGrid>
      <Box sx={{ mt: 2 }}>
        <LabelSelectorEditor
          label={t('Advertisements')}
          optional
          value={family.advertisements}
          onChange={v => onChange(withField(family, 'advertisements', v))}
          nilText={t('Not set: nothing is advertised for this family.')}
          emptyText={t('An empty selector picks up every CiliumBGPAdvertisement.')}
          help={t('Selects CiliumBGPAdvertisement objects by their labels.')}
          keySuggestions={['advertise']}
        />
      </Box>
    </Box>
  );
}

/** Timers, authentication and graceful restart; shared by the form and the setup wizard. */
export function PeerSessionFields({
  value,
  onChange,
}: Pick<ResourceFormProps, 'value' | 'onChange'>) {
  const { t } = useText();
  const bind = useBinder<KubeJson>(value, onChange);
  const graceful = value.spec?.gracefulRestart;
  return (
    <>
      <FieldGrid columns={3}>
        <NumberInput
          label={t('Hold time (seconds)')}
          min={3}
          max={65535}
          placeholder="90"
          {...bind(['spec', 'timers', 'holdTimeSeconds'])}
        />
        <NumberInput
          label={t('Keepalive time (seconds)')}
          min={1}
          max={65535}
          placeholder="30"
          {...bind(['spec', 'timers', 'keepAliveTimeSeconds'])}
        />
        <NumberInput
          label={t('Connect retry time (seconds)')}
          min={1}
          max={65535}
          placeholder="120"
          {...bind(['spec', 'timers', 'connectRetryTimeSeconds'])}
        />
        <NumberInput
          label={t('Peer port')}
          min={1}
          max={65535}
          placeholder="179"
          {...bind(['spec', 'transport', 'peerPort'])}
        />
        <NumberInput
          label={t('eBGP multihop TTL')}
          min={1}
          max={255}
          help={t('Set when the eBGP peer is more than one hop away.')}
          {...bind(['spec', 'ebgpMultihop'])}
        />
        <TextInput
          label={t('Authentication secret')}
          help={t(
            'Name of a Secret in the Cilium namespace whose "password" key holds the TCP MD5 password.'
          )}
          {...bind(['spec', 'authSecretRef'])}
        />
      </FieldGrid>
      <Box sx={{ mt: 1 }}>
        <FieldGrid>
          <SwitchInput
            label={t('Graceful restart')}
            help={t('Peers keep the routes while the Cilium agent restarts.')}
            value={!!graceful?.enabled}
            onChange={v =>
              onChange(
                setIn(
                  value,
                  ['spec', 'gracefulRestart'],
                  v
                    ? { enabled: true, restartTimeSeconds: graceful?.restartTimeSeconds ?? 120 }
                    : undefined
                )
              )
            }
          />
          {graceful?.enabled && (
            <NumberInput
              label={t('Restart time (seconds)')}
              min={1}
              max={4095}
              {...bind(['spec', 'gracefulRestart', 'restartTimeSeconds'])}
            />
          )}
        </FieldGrid>
      </Box>
    </>
  );
}

export function BGPPeerConfigForm({ value, onChange, mode }: ResourceFormProps) {
  const { t } = useText();
  const bind = useBinder<KubeJson>(value, onChange);
  const families = bind<BGPFamily[]>(['spec', 'families']);
  return (
    <>
      <FormSection title={t('General')} icon="mdi:tag-outline">
        <MetadataFields value={value} onChange={onChange} mode={mode} />
      </FormSection>
      <FormSection title={t('Session')} icon="mdi:handshake-outline">
        <PeerSessionFields value={value} onChange={onChange} />
        <Box sx={{ mt: 2, maxWidth: 420 }}>
          <TextInput
            label={t('Source interface')}
            placeholder="lo"
            help={t('Interface whose address is used as the source of the BGP session.')}
            {...bind(['spec', 'transport', 'sourceInterface'])}
          />
        </Box>
      </FormSection>
      <FormSection
        title={t('Address families')}
        description={t(
          'Families negotiated with the peer and the advertisements sent for each of them. IPv4 unicast is negotiated when the list is empty.'
        )}
        icon="mdi:family-tree"
      >
        <ArrayEditor<BGPFamily>
          items={families.value}
          onChange={families.onChange}
          newItem={() => ({ afi: 'ipv4', safi: 'unicast' })}
          addLabel={t('Add address family')}
          itemTitle={family => `${family.afi}/${family.safi}`}
          renderItem={(family, update) => <FamilyEditor family={family} onChange={update} />}
        />
      </FormSection>
    </>
  );
}

function AdvertisementEditor({
  entry,
  onChange,
}: {
  entry: BGPAdvertisementEntry;
  onChange: (next: BGPAdvertisementEntry) => void;
}) {
  const { t } = useText();
  const type = entry.advertisementType;
  const communities = entry.attributes?.communities;
  const setAttributes = (patch: Partial<NonNullable<BGPAdvertisementEntry['attributes']>>) => {
    const next = { ...(entry.attributes || {}), ...patch };
    for (const key of Object.keys(next) as Array<keyof typeof next>) {
      const v = next[key];
      if (v === undefined || (typeof v === 'object' && Object.keys(v).length === 0))
        delete next[key];
    }
    onChange(withField(entry, 'attributes', Object.keys(next).length ? next : undefined));
  };
  const setCommunities = (key: 'standard' | 'large' | 'wellKnown', list?: string[]) =>
    setAttributes({ communities: withField(communities || {}, key, list) });

  return (
    <Box>
      <FieldGrid columns={3}>
        <SelectInput
          label={t('Type')}
          allowEmpty={false}
          options={[
            { value: 'PodCIDR', label: t('Pod CIDRs') },
            { value: 'Service', label: t('Services') },
            { value: 'CiliumPodIPPool', label: t('Pod IP pools') },
            { value: 'Interface', label: t('Interface addresses') },
          ]}
          value={type}
          onChange={v => {
            const next = (v as AdvertisementType) || 'PodCIDR';
            const base: BGPAdvertisementEntry = { advertisementType: next };
            if (entry.attributes) base.attributes = entry.attributes;
            if (next === 'Service') {
              base.service = { addresses: ['LoadBalancerIP'] };
              base.selector = {};
            }
            if (next === 'CiliumPodIPPool') base.selector = {};
            if (next === 'Interface') base.interface = { name: '' };
            onChange(base);
          }}
        />
        {type === 'Service' && (
          <>
            <StringListInput
              label={t('Service addresses')}
              suggestions={SERVICE_ADDRESS_TYPES}
              validateItem={v => (SERVICE_ADDRESS_TYPES as string[]).includes(v)}
              value={entry.service?.addresses}
              onChange={v =>
                onChange({
                  ...entry,
                  service: {
                    ...entry.service,
                    addresses: (v || []) as typeof SERVICE_ADDRESS_TYPES,
                  },
                })
              }
            />
            <NumberInput
              label={t('IPv4 aggregation length')}
              min={1}
              max={31}
              help={t('Advertise an aggregate prefix of this length instead of /32 routes.')}
              value={entry.service?.aggregationLengthIPv4}
              onChange={v =>
                onChange({
                  ...entry,
                  service: withField(entry.service || {}, 'aggregationLengthIPv4', v),
                })
              }
            />
          </>
        )}
        {type === 'Interface' && (
          <TextInput
            label={t('Interface name')}
            required
            placeholder="lo"
            value={entry.interface?.name}
            onChange={v => onChange({ ...entry, interface: { name: v || '' } })}
          />
        )}
      </FieldGrid>
      {(type === 'Service' || type === 'CiliumPodIPPool') && (
        <Box sx={{ mt: 2 }}>
          <LabelSelectorEditor
            label={type === 'Service' ? t('Service selector') : t('Pool selector')}
            value={entry.selector || {}}
            onChange={v => onChange({ ...entry, selector: v || {} })}
            emptyText={
              type === 'Service'
                ? t('An empty selector advertises every service.')
                : t('An empty selector advertises every pod IP pool.')
            }
          />
        </Box>
      )}
      <FieldGrid columns={3}>
        <Box sx={{ mt: 2 }}>
          <StringListInput
            label={t('Standard communities')}
            placeholder="65000:100"
            value={communities?.standard}
            onChange={v => setCommunities('standard', v)}
          />
        </Box>
        <Box sx={{ mt: 2 }}>
          <StringListInput
            label={t('Large communities')}
            placeholder="65000:100:50"
            value={communities?.large}
            onChange={v => setCommunities('large', v)}
          />
        </Box>
        <Box sx={{ mt: 2 }}>
          <NumberInput
            label={t('Local preference')}
            min={0}
            max={MAX_ASN}
            help={t('Only used for iBGP peers.')}
            value={entry.attributes?.localPreference}
            onChange={v => setAttributes({ localPreference: v })}
          />
        </Box>
      </FieldGrid>
    </Box>
  );
}

const TYPE_LABELS: Record<string, string> = {
  PodCIDR: 'Pod CIDRs',
  Service: 'Services',
  CiliumPodIPPool: 'Pod IP pools',
  Interface: 'Interface addresses',
};

export function BGPAdvertisementForm({ value, onChange, mode }: ResourceFormProps) {
  const { t } = useText();
  const bind = useBinder<KubeJson>(value, onChange);
  const entries = bind<BGPAdvertisementEntry[]>(['spec', 'advertisements']);
  return (
    <>
      <FormSection title={t('General')} icon="mdi:tag-outline">
        <MetadataFields value={value} onChange={onChange} mode={mode} />
      </FormSection>
      <FormSection
        title={t('Labels')}
        description={t(
          'BGP peer configs select advertisements by label. Without a label that a peer config selects, this advertisement is not announced.'
        )}
        icon="mdi:label-outline"
      >
        <KeyValueEditor
          validateLabels
          keySuggestions={['advertise']}
          {...bind(['metadata', 'labels'])}
        />
      </FormSection>
      <FormSection title={t('Advertisements')} icon="mdi:bullhorn-outline">
        <ArrayEditor<BGPAdvertisementEntry>
          items={entries.value}
          onChange={entries.onChange}
          newItem={() => ({ advertisementType: 'PodCIDR' })}
          addLabel={t('Add advertisement')}
          itemTitle={entry => t(TYPE_LABELS[entry.advertisementType] || entry.advertisementType)}
          minItems={1}
          renderItem={(entry, update) => <AdvertisementEditor entry={entry} onChange={update} />}
        />
      </FormSection>
    </>
  );
}

function OverrideInstanceEditor({
  instance,
  onChange,
}: {
  instance: BGPNodeOverrideInstance;
  onChange: (next: BGPNodeOverrideInstance) => void;
}) {
  const { t } = useText();
  type PeerOverride = NonNullable<BGPNodeOverrideInstance['peers']>[number];
  return (
    <Box>
      <FieldGrid columns={3}>
        <TextInput
          label={t('Instance name')}
          required
          help={t('Must match an instance name of the BGP cluster config.')}
          value={instance.name}
          onChange={v => onChange({ ...instance, name: v || '' })}
        />
        <TextInput
          label={t('Router ID')}
          placeholder="10.0.0.11"
          value={instance.routerID}
          error={ipError(instance.routerID, t('Not a valid IPv4 address'))}
          onChange={v => onChange(withField(instance, 'routerID', v))}
        />
        <NumberInput
          label={t('Local port')}
          min={1}
          max={65535}
          value={instance.localPort}
          onChange={v => onChange(withField(instance, 'localPort', v))}
        />
      </FieldGrid>
      <Typography variant="subtitle2" sx={{ mt: 2, mb: 1 }}>
        {t('Peer overrides')}
      </Typography>
      <ArrayEditor<PeerOverride>
        items={instance.peers}
        onChange={peers => onChange(withField(instance, 'peers', peers))}
        newItem={() => ({ name: '' })}
        addLabel={t('Add peer override')}
        itemTitle={(peer, i) => peer.name || t('Peer #{{index}}', { index: i + 1 })}
        renderItem={(peer, update) => (
          <FieldGrid columns={3}>
            <TextInput
              label={t('Peer name')}
              required
              value={peer.name}
              onChange={v => update({ ...peer, name: v || '' })}
            />
            <TextInput
              label={t('Local address')}
              value={peer.localAddress}
              error={ipError(peer.localAddress, t('Not a valid IP address'))}
              onChange={v => update(withField(peer, 'localAddress', v))}
            />
            <NumberInput
              label={t('Local port')}
              min={1}
              max={65535}
              value={peer.localPort}
              onChange={v => update(withField(peer, 'localPort', v))}
            />
          </FieldGrid>
        )}
      />
    </Box>
  );
}

export function BGPNodeConfigOverrideForm({ value, onChange, mode }: ResourceFormProps) {
  const { t } = useText();
  const bind = useBinder<KubeJson>(value, onChange);
  const instances = bind<BGPNodeOverrideInstance[]>(['spec', 'bgpInstances']);
  return (
    <>
      <FormSection
        title={t('Node')}
        description={t('An override applies to the node with the same name as the object.')}
        icon="mdi:server"
      >
        <Box sx={{ maxWidth: 480 }}>
          <NameAutocomplete
            // Node is one of Headlamp's built-in classes, always present.
            cls={coreClass('Node')!}
            label={t('Node name')}
            required
            disabled={mode === 'edit'}
            value={value.metadata?.name}
            onChange={v => onChange(setIn(value, ['metadata', 'name'], v))}
          />
        </Box>
      </FormSection>
      <FormSection title={t('Instance overrides')} icon="mdi:router-network">
        <ArrayEditor<BGPNodeOverrideInstance>
          items={instances.value}
          onChange={instances.onChange}
          newItem={() => ({ name: '' })}
          addLabel={t('Add instance override')}
          itemTitle={(instance, i) => instance.name || t('Instance #{{index}}', { index: i + 1 })}
          minItems={1}
          renderItem={(instance, update) => (
            <OverrideInstanceEditor instance={instance} onChange={update} />
          )}
        />
      </FormSection>
    </>
  );
}
