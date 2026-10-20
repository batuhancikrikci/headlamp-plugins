import { Alert, Box, Typography } from '@mui/material';
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
  ToggleSection,
  useBinder,
} from '../../common/form/Fields';
import { ResourceFormProps } from '../../common/form/ResourceEditor';
import { useText } from '../../common/i18n';
import { setIn } from '../../common/objects';
import { LBIPBlock, PodIPPoolFamily } from '../../resources/network';
import { KubeJson } from '../../resources/types';
import { blockSize, formatCount, isValidCIDR, isValidIP } from '../../utils/cidr';
import { SERVICE_NAME_LABEL, SERVICE_NAMESPACE_LABEL } from '../../utils/relations';
import { isValidRegex } from '../../utils/validation';
import { CIDRListInput, LabelSelectorEditor, MetadataFields } from '../common/form/SelectorEditor';
import { NODE_LABEL_KEYS } from '../nodes/Forms';

const SERVICE_KEYS = [SERVICE_NAMESPACE_LABEL, SERVICE_NAME_LABEL, 'app.kubernetes.io/name'];

function BlockEditor({
  block,
  onChange,
  allowFirstLast,
}: {
  block: LBIPBlock;
  onChange: (next: LBIPBlock) => void;
  allowFirstLast: boolean;
}) {
  const { t } = useText();
  const isRange = block.start !== undefined;
  const size = blockSize(block, allowFirstLast);
  return (
    <Box>
      <FieldGrid columns={3}>
        <SelectInput
          label={t('Type')}
          allowEmpty={false}
          options={[
            { value: 'cidr', label: 'CIDR' },
            { value: 'range', label: t('Address range') },
          ]}
          value={isRange ? 'range' : 'cidr'}
          onChange={v => onChange(v === 'range' ? { start: '', stop: '' } : { cidr: '' })}
        />
        {isRange ? (
          <>
            <TextInput
              label={t('Start address')}
              required
              placeholder="192.168.10.100"
              monospace
              value={block.start}
              error={
                block.start && !isValidIP(block.start) ? t('Not a valid IP address') : undefined
              }
              onChange={v => onChange({ ...block, start: v || '' })}
            />
            <TextInput
              label={t('Stop address')}
              placeholder="192.168.10.150"
              monospace
              value={block.stop}
              error={block.stop && !isValidIP(block.stop) ? t('Not a valid IP address') : undefined}
              helperText={t('Empty for a single address')}
              onChange={v => {
                const next = { ...block };
                if (v) next.stop = v;
                else delete next.stop;
                onChange(next);
              }}
            />
          </>
        ) : (
          <TextInput
            label="CIDR"
            required
            placeholder="192.168.10.0/24"
            monospace
            value={block.cidr}
            error={block.cidr && !isValidCIDR(block.cidr) ? t('Not a valid CIDR') : undefined}
            onChange={v => onChange({ cidr: v || '' })}
          />
        )}
      </FieldGrid>
      {size !== null && (
        <Typography variant="caption" color="text.secondary">
          {t('{{count}} usable address(es)', { count: formatCount(size) })}
        </Typography>
      )}
    </Box>
  );
}

/** Blocks, service selector and options of an LB IP pool; shared with the setup wizard. */
export function LBIPPoolFields({ value, onChange }: Pick<ResourceFormProps, 'value' | 'onChange'>) {
  const { t } = useText();
  const bind = useBinder<KubeJson>(value, onChange);
  const blocks = bind<LBIPBlock[]>(['spec', 'blocks']);
  const allowFirstLast = value.spec?.allowFirstLastIPs !== 'No';
  return (
    <>
      <FormSection
        title={t('IP blocks')}
        description={t('Addresses LB IPAM may assign to LoadBalancer services.')}
        icon="mdi:ip-network-outline"
      >
        <ArrayEditor<LBIPBlock>
          items={blocks.value}
          onChange={blocks.onChange}
          newItem={() => ({ cidr: '' })}
          addLabel={t('Add block')}
          itemTitle={(_, i) => t('Block #{{index}}', { index: i + 1 })}
          minItems={1}
          renderItem={(block, update) => (
            <BlockEditor block={block} onChange={update} allowFirstLast={allowFirstLast} />
          )}
        />
      </FormSection>
      <FormSection
        title={t('Services')}
        description={t('Limit the pool to some services, for example by namespace.')}
        icon="mdi:lan"
      >
        <LabelSelectorEditor
          label={t('Service selector')}
          optional
          nilText={t('Not set: every LoadBalancer service may use this pool.')}
          emptyText={t('An empty selector matches every service.')}
          keySuggestions={SERVICE_KEYS}
          help={t(
            'Besides the service labels, io.kubernetes.service.namespace and io.kubernetes.service.name can be used as keys.'
          )}
          {...bind(['spec', 'serviceSelector'])}
        />
      </FormSection>
      <FormSection title={t('Options')} icon="mdi:tune">
        <FieldGrid>
          <SelectInput
            label={t('Allow first and last IPs')}
            options={['Yes', 'No']}
            help={t(
              'Whether the first and last address of a CIDR block (network and broadcast) are handed out. Applies to CIDR blocks only.'
            )}
            {...bind(['spec', 'allowFirstLastIPs'])}
          />
          <SwitchInput
            label={t('Disabled')}
            help={t('Stops new allocations from this pool; existing allocations are kept.')}
            {...bind(['spec', 'disabled'])}
          />
        </FieldGrid>
      </FormSection>
    </>
  );
}

export function LBIPPoolForm({ value, onChange, mode }: ResourceFormProps) {
  const { t } = useText();
  return (
    <>
      <FormSection title={t('General')} icon="mdi:tag-outline">
        <MetadataFields value={value} onChange={onChange} mode={mode} />
      </FormSection>
      <LBIPPoolFields value={value} onChange={onChange} />
    </>
  );
}

/** What is announced, on which interfaces and nodes; shared with the setup wizard. */
export function L2AnnouncementFields({
  value,
  onChange,
  hideServiceSelector,
}: Pick<ResourceFormProps, 'value' | 'onChange'> & { hideServiceSelector?: boolean }) {
  const { t } = useText();
  const bind = useBinder<KubeJson>(value, onChange);
  return (
    <>
      <FormSection
        title={t('Announcements')}
        description={t('Which service IPs are answered for with ARP (IPv4) and NDP (IPv6).')}
        icon="mdi:access-point-network"
      >
        <FieldGrid>
          <SwitchInput label={t('LoadBalancer IPs')} {...bind(['spec', 'loadBalancerIPs'])} />
          <SwitchInput label={t('External IPs')} {...bind(['spec', 'externalIPs'])} />
        </FieldGrid>
        <Box sx={{ mt: 2 }}>
          <StringListInput
            label={t('Interfaces')}
            placeholder="^eth[0-9]+"
            validateItem={isValidRegex}
            help={t(
              'Regular expressions matching the network interfaces to announce on. Empty announces on all interfaces.'
            )}
            {...bind(['spec', 'interfaces'])}
          />
        </Box>
      </FormSection>
      <FormSection
        title={t('Nodes')}
        description={t('Nodes that may announce. One of them holds the lease per service.')}
        icon="mdi:server"
      >
        <LabelSelectorEditor
          label={t('Node selector')}
          optional
          nilText={t('Not set: every node may announce.')}
          emptyText={t('An empty selector matches every node.')}
          keySuggestions={NODE_LABEL_KEYS}
          {...bind(['spec', 'nodeSelector'])}
        />
      </FormSection>
      {!hideServiceSelector && (
        <FormSection title={t('Services')} icon="mdi:lan">
          <LabelSelectorEditor
            label={t('Service selector')}
            optional
            nilText={t('Not set: every service is announced.')}
            emptyText={t('An empty selector matches every service.')}
            keySuggestions={SERVICE_KEYS}
            {...bind(['spec', 'serviceSelector'])}
          />
        </FormSection>
      )}
    </>
  );
}

export function L2AnnouncementPolicyForm({ value, onChange, mode }: ResourceFormProps) {
  const { t } = useText();
  return (
    <>
      <FormSection title={t('General')} icon="mdi:tag-outline">
        <MetadataFields value={value} onChange={onChange} mode={mode} />
      </FormSection>
      <L2AnnouncementFields value={value} onChange={onChange} />
    </>
  );
}

function PodPoolFamily({
  title,
  version,
  family,
  onChange,
}: {
  title: string;
  version: 4 | 6;
  family: PodIPPoolFamily | undefined;
  onChange: (next: PodIPPoolFamily | undefined) => void;
}) {
  const { t } = useText();
  return (
    <ToggleSection
      title={title}
      icon="mdi:cube-scan"
      enabled={!!family}
      onToggle={enabled =>
        onChange(enabled ? { cidrs: [], maskSize: version === 4 ? 27 : 64 } : undefined)
      }
    >
      <FieldGrid>
        <CIDRListInput
          label={t('CIDRs')}
          placeholder={version === 4 ? '10.20.0.0/16' : 'fd00:20::/104'}
          value={family?.cidrs}
          onChange={v => onChange({ ...family, cidrs: v || [] })}
        />
        <NumberInput
          label={t('Per-node mask size')}
          required
          min={1}
          max={version === 4 ? 32 : 128}
          help={t('Size of the block each node receives from the pool.')}
          value={family?.maskSize}
          onChange={v => onChange({ ...family, maskSize: v })}
        />
      </FieldGrid>
    </ToggleSection>
  );
}

export function PodIPPoolForm({ value, onChange, mode }: ResourceFormProps) {
  const { t } = useText();
  const setFamily = (key: 'ipv4' | 'ipv6', family: PodIPPoolFamily | undefined) =>
    onChange(setIn(value, ['spec', key], family));
  return (
    <>
      <FormSection title={t('General')} icon="mdi:tag-outline">
        <MetadataFields value={value} onChange={onChange} mode={mode} />
        <Alert severity="info" sx={{ mt: 2 }}>
          {t(
            'Pod IP pools require multi-pool IPAM. Pods select a pool with the annotation ipam.cilium.io/ip-pool on the pod or its namespace.'
          )}
        </Alert>
      </FormSection>
      <PodPoolFamily
        title="IPv4"
        version={4}
        family={value.spec?.ipv4}
        onChange={f => setFamily('ipv4', f)}
      />
      <PodPoolFamily
        title="IPv6"
        version={6}
        family={value.spec?.ipv6}
        onChange={f => setFamily('ipv6', f)}
      />
    </>
  );
}
