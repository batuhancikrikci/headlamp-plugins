import { Icon } from '@iconify/react';
import { Alert, Box, Typography } from '@mui/material';
import React from 'react';
import { CodeBlock } from '../../common/CodeBlock';
import {
  ArrayEditor,
  FieldGrid,
  FormSection,
  SelectInput,
  SwitchInput,
  TextInput,
  useBinder,
} from '../../common/form/Fields';
import { ResourceFormProps } from '../../common/form/ResourceEditor';
import { SummaryList, Wizard } from '../../common/form/Wizard';
import { useText } from '../../common/i18n';
import { setIn } from '../../common/objects';
import { dumpYaml } from '../../common/yaml';
import { useNamespaceLabels, usePods } from '../../hooks/useClusterData';
import { EgressGateway, EgressRuleSelector, RedirectPort } from '../../resources/network';
import { KubeJson, Protocol } from '../../resources/types';
import { isValidIP } from '../../utils/cidr';
import { NAMESPACE_LABEL } from '../../utils/policyMatch';
import { egressPolicySelectsPod } from '../../utils/relations';
import {
  CIDRListInput,
  LabelSelectorEditor,
  MetadataFields,
  NameAutocomplete,
  NamespaceInput,
} from '../common/form/SelectorEditor';
import { MatchingNodes } from '../common/MatchingNodes';
import { coreClass } from '../common/ResourceRefLink';
import { SelectorView, StringArray } from '../common/Shared';
import { NODE_LABEL_KEYS } from '../nodes/Forms';
import { withField } from '../policies/RuleEditor';

function SelectorsEditor({
  selectors,
  onChange,
}: {
  selectors: EgressRuleSelector[] | undefined;
  onChange: (next: EgressRuleSelector[] | undefined) => void;
}) {
  const { t } = useText();
  return (
    <ArrayEditor<EgressRuleSelector>
      items={selectors}
      onChange={onChange}
      newItem={() => ({ podSelector: { matchLabels: {} } })}
      addLabel={t('Add selector')}
      itemTitle={(_, i) => t('Selector #{{index}}', { index: i + 1 })}
      minItems={1}
      renderItem={(selector, update) => (
        <Box>
          <LabelSelectorEditor
            label={t('Pod selector')}
            value={selector.podSelector || { matchLabels: {} }}
            onChange={v => update({ ...selector, podSelector: v || { matchLabels: {} } })}
            keySuggestions={['app', 'app.kubernetes.io/name', NAMESPACE_LABEL]}
            emptyText={t('An empty selector matches every pod.')}
            help={t(
              'Use the label io.kubernetes.pod.namespace to limit the selector to a namespace.'
            )}
          />
          <Box sx={{ mt: 2 }}>
            <LabelSelectorEditor
              label={t('Namespace selector')}
              optional
              value={selector.namespaceSelector}
              onChange={v => update(withField(selector, 'namespaceSelector', v))}
              nilText={t('Not set: pods in all namespaces can match.')}
              keySuggestions={['kubernetes.io/metadata.name']}
              emptyText={t('An empty selector matches every namespace.')}
            />
          </Box>
        </Box>
      )}
    />
  );
}

type SourceMode = 'default' | 'interface' | 'egressIP';

function sourceMode(gateway: EgressGateway): SourceMode {
  if (gateway.egressIP !== undefined) return 'egressIP';
  if (gateway.interface !== undefined) return 'interface';
  return 'default';
}

function GatewayEditor({
  gateway,
  onChange,
}: {
  gateway: EgressGateway;
  onChange: (next: EgressGateway) => void;
}) {
  const { t } = useText();
  const mode = sourceMode(gateway);
  const setMode = (next: SourceMode) => {
    const base: EgressGateway = { nodeSelector: gateway.nodeSelector };
    if (next === 'interface') base.interface = '';
    if (next === 'egressIP') base.egressIP = '';
    onChange(base);
  };
  return (
    <Box>
      <LabelSelectorEditor
        label={t('Gateway node selector')}
        value={gateway.nodeSelector || { matchLabels: {} }}
        onChange={v => onChange({ ...gateway, nodeSelector: v || { matchLabels: {} } })}
        keySuggestions={NODE_LABEL_KEYS}
        emptyText={t('An empty selector matches every node; prefer a dedicated label.')}
      />
      <Box sx={{ mt: 2 }}>
        <FieldGrid>
          <SelectInput
            label={t('Source address')}
            allowEmpty={false}
            options={[
              { value: 'default', label: t('IP of the default route interface') },
              { value: 'interface', label: t('First IPv4 of an interface') },
              { value: 'egressIP', label: t('Specific egress IP') },
            ]}
            value={mode}
            onChange={v => setMode((v as SourceMode) || 'default')}
          />
          {mode === 'interface' && (
            <TextInput
              label={t('Interface')}
              placeholder="eth1"
              value={gateway.interface}
              onChange={v => onChange({ ...gateway, interface: v || '' })}
            />
          )}
          {mode === 'egressIP' && (
            <TextInput
              label={t('Egress IP')}
              placeholder="192.168.10.50"
              monospace
              value={gateway.egressIP}
              error={
                gateway.egressIP && !isValidIP(gateway.egressIP)
                  ? t('Not a valid IP address')
                  : undefined
              }
              helperText={t('Must be assigned to an interface of the gateway node')}
              onChange={v => onChange({ ...gateway, egressIP: v || '' })}
            />
          )}
        </FieldGrid>
      </Box>
    </Box>
  );
}

const DEFAULT_GATEWAY: EgressGateway = { nodeSelector: { matchLabels: {} } };

function DestinationFields({ value, onChange }: Pick<ResourceFormProps, 'value' | 'onChange'>) {
  const { t } = useText();
  const bind = useBinder<KubeJson>(value, onChange);
  return (
    <FieldGrid>
      <CIDRListInput
        label={t('Destination CIDRs')}
        placeholder="0.0.0.0/0"
        help={t(
          'Traffic to these destinations leaves through the gateway. Use 0.0.0.0/0 for all external traffic.'
        )}
        {...bind(['spec', 'destinationCIDRs'])}
      />
      <CIDRListInput
        label={t('Excluded CIDRs')}
        placeholder="10.0.0.0/8"
        help={t('Destinations inside the destination CIDRs that should not use the gateway.')}
        {...bind(['spec', 'excludedCIDRs'])}
      />
    </FieldGrid>
  );
}

export function EgressGatewayPolicyForm({ value, onChange, mode }: ResourceFormProps) {
  const { t } = useText();
  const bind = useBinder<KubeJson>(value, onChange);
  const selectors = bind<EgressRuleSelector[]>(['spec', 'selectors']);
  const usesList =
    Array.isArray(value.spec?.egressGateways) && value.spec.egressGateways.length > 0;
  return (
    <>
      <FormSection title={t('General')} icon="mdi:tag-outline">
        <MetadataFields value={value} onChange={onChange} mode={mode} />
      </FormSection>
      <FormSection
        title={t('Source pods')}
        description={t('Pods whose outgoing traffic is routed through the gateway.')}
        icon="mdi:cube-outline"
      >
        <SelectorsEditor selectors={selectors.value} onChange={selectors.onChange} />
      </FormSection>
      <FormSection title={t('Destinations')} icon="mdi:earth">
        <DestinationFields value={value} onChange={onChange} />
      </FormSection>
      <FormSection
        title={t('Egress gateway')}
        description={t('The node that forwards the traffic, and the source address it uses.')}
        icon="mdi:exit-to-app"
      >
        {usesList && (
          <Alert severity="info" sx={{ mb: 2 }}>
            {t(
              'This policy also defines a list of gateways (egressGateways); edit that list in the YAML tab.'
            )}
          </Alert>
        )}
        <GatewayEditor
          gateway={value.spec?.egressGateway || DEFAULT_GATEWAY}
          onChange={gateway => onChange(setIn(value, ['spec', 'egressGateway'], gateway))}
        />
      </FormSection>
    </>
  );
}

/** Live count of the pods an egress policy selects. */
function SelectedPodsPreview({ value }: { value: KubeJson }) {
  const { t } = useText();
  const pods = usePods();
  const namespaceLabels = useNamespaceLabels();
  if (pods.error && !pods.items) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
        {t('Matching pods cannot be previewed because pods could not be listed.')}
      </Typography>
    );
  }
  const matched = (pods.items || []).filter(
    pod =>
      !pod.spec?.hostNetwork &&
      egressPolicySelectsPod(value.spec, pod, namespaceLabels[pod.metadata.namespace || ''])
  );
  return (
    <Alert
      sx={{ mt: 2 }}
      severity={pods.items && matched.length === 0 ? 'warning' : 'info'}
      icon={<Icon icon="mdi:target" />}
    >
      {pods.items === null
        ? t('Looking up matching pods…')
        : matched.length === 0
        ? t('No pod currently matches these selectors.')
        : t('{{count}} pod(s) currently match: {{names}}', {
            count: matched.length,
            names:
              matched
                .slice(0, 6)
                .map(p => `${p.metadata.namespace}/${p.metadata.name}`)
                .join(', ') + (matched.length > 6 ? '…' : ''),
          })}
    </Alert>
  );
}

/** Step-by-step creation of an egress gateway policy: source, destinations, gateway, review. */
export function EgressGatewayPolicyWizard({
  value,
  onChange,
  mode,
  errors,
  onSubmit,
  submitting,
}: ResourceFormProps) {
  const { t } = useText();
  const bind = useBinder<KubeJson>(value, onChange);
  const selectors = bind<EgressRuleSelector[]>(['spec', 'selectors']);
  const gateway: EgressGateway = value.spec?.egressGateway || DEFAULT_GATEWAY;
  const stepErrors = (match: RegExp) =>
    errors.filter(e =>
      match.test(`${e.key} ${String(e.params?.where ?? '')} ${String(e.params?.what ?? '')}`)
    );

  return (
    <Wizard
      onSubmit={onSubmit}
      submitting={submitting}
      submitLabel={mode === 'create' ? t('Create policy') : t('Apply')}
      allErrors={errors}
      steps={[
        {
          id: 'source',
          label: t('Source pods'),
          description: t(
            'Name the policy and select the pods whose outgoing traffic should leave the cluster through a gateway node.'
          ),
          errors: stepErrors(/name|Selector #|pod selector/i),
          content: (
            <>
              <MetadataFields value={value} onChange={onChange} mode={mode} />
              <Box sx={{ mt: 3 }}>
                <SelectorsEditor selectors={selectors.value} onChange={selectors.onChange} />
              </Box>
              <SelectedPodsPreview value={value} />
            </>
          ),
        },
        {
          id: 'destinations',
          label: t('Destinations'),
          description: t(
            'Only traffic to these destinations is sent through the gateway. Cluster-internal traffic is never affected.'
          ),
          errors: stepErrors(/CIDR/),
          content: <DestinationFields value={value} onChange={onChange} />,
        },
        {
          id: 'gateway',
          label: t('Gateway'),
          description: t(
            'Choose the gateway node and the source address external systems will see (for example the address allowed by a firewall).'
          ),
          errors: stepErrors(/Gateway/),
          content: (
            <>
              <GatewayEditor
                gateway={gateway}
                onChange={next => onChange(setIn(value, ['spec', 'egressGateway'], next))}
              />
              <Typography
                variant="caption"
                color="text.secondary"
                component="div"
                sx={{ mt: 2, mb: 0.5 }}
              >
                {t('Gateway nodes:')}
              </Typography>
              <MatchingNodes
                selector={gateway.nodeSelector}
                emptyMessage={t(
                  'No node matches the gateway selector. Selected traffic is dropped until a gateway node exists.'
                )}
              />
            </>
          ),
        },
        {
          id: 'review',
          label: t('Review'),
          description: t('Check the policy before it is applied.'),
          content: (
            <>
              <SummaryList
                rows={[
                  { label: t('Name'), value: value.metadata?.name || '-' },
                  {
                    label: t('Source pods'),
                    value: (
                      <>
                        {(value.spec?.selectors || []).map((s: EgressRuleSelector, i: number) => (
                          // eslint-disable-next-line react/no-array-index-key
                          <SelectorView
                            key={i}
                            selector={s.podSelector}
                            emptyLabel={t('All pods')}
                          />
                        ))}
                      </>
                    ),
                  },
                  {
                    label: t('Destinations'),
                    value: <StringArray items={value.spec?.destinationCIDRs} monospace />,
                  },
                  {
                    label: t('Gateway nodes'),
                    value: (
                      <SelectorView selector={gateway.nodeSelector} emptyLabel={t('All nodes')} />
                    ),
                  },
                  {
                    label: t('Source address'),
                    value:
                      gateway.egressIP ||
                      (gateway.interface
                        ? t('First IPv4 of interface {{name}}', { name: gateway.interface })
                        : t('IP of the default route interface')),
                  },
                ]}
              />
              <Typography variant="subtitle2" sx={{ mt: 3, mb: 1 }}>
                {t('YAML preview')}
              </Typography>
              <CodeBlock value={dumpYaml(value)} maxHeight={320} />
            </>
          ),
        },
      ]}
    />
  );
}

const REDIRECT_PROTOCOLS: Protocol[] = ['TCP', 'UDP'];

function RedirectPorts({
  ports,
  onChange,
}: {
  ports: RedirectPort[] | undefined;
  onChange: (next: RedirectPort[] | undefined) => void;
}) {
  const { t } = useText();
  return (
    <ArrayEditor<RedirectPort>
      items={ports}
      onChange={onChange}
      newItem={() => ({ port: '', protocol: 'TCP' })}
      addLabel={t('Add port')}
      itemTitle={(port, i) => port.name || t('Port #{{index}}', { index: i + 1 })}
      renderItem={(port, update) => (
        <FieldGrid columns={3}>
          <TextInput
            label={t('Port')}
            required
            placeholder="53"
            value={port.port}
            onChange={v => update({ ...port, port: v || '' })}
          />
          <SelectInput
            label={t('Protocol')}
            allowEmpty={false}
            options={REDIRECT_PROTOCOLS}
            value={port.protocol || 'TCP'}
            onChange={v => update({ ...port, protocol: (v as Protocol) || 'TCP' })}
          />
          <TextInput
            label={t('Name')}
            placeholder="dns"
            helperText={t('Required with several ports; pairs frontend and backend ports')}
            value={port.name}
            onChange={v => update(withField(port, 'name', v))}
          />
        </FieldGrid>
      )}
    />
  );
}

export function LocalRedirectPolicyForm({ value, onChange, mode }: ResourceFormProps) {
  const { t } = useText();
  const bind = useBinder<KubeJson>(value, onChange);
  const frontend = value.spec?.redirectFrontend || {};
  const useService = !!frontend.serviceMatcher;
  const namespace = value.metadata?.namespace;
  const setFrontend = (next: object) => onChange(setIn(value, ['spec', 'redirectFrontend'], next));

  return (
    <>
      <FormSection title={t('General')} icon="mdi:tag-outline">
        <MetadataFields value={value} onChange={onChange} mode={mode} />
        <Box sx={{ mt: 2 }}>
          <TextInput label={t('Description')} {...bind(['spec', 'description'])} />
        </Box>
        {mode === 'edit' && (
          <Alert severity="info" sx={{ mt: 2 }}>
            {t(
              'Cilium does not support changing the frontend or backend of an existing local redirect policy; delete and recreate the policy instead.'
            )}
          </Alert>
        )}
      </FormSection>
      <FormSection
        title={t('Frontend')}
        description={t('The address or service whose traffic is redirected.')}
        icon="mdi:import"
      >
        <Box sx={{ maxWidth: 320, mb: 2 }}>
          <SelectInput
            label={t('Frontend type')}
            allowEmpty={false}
            options={[
              { value: 'address', label: t('IP address') },
              { value: 'service', label: t('Service') },
            ]}
            value={useService ? 'service' : 'address'}
            onChange={v =>
              setFrontend(
                v === 'service'
                  ? { serviceMatcher: { serviceName: '', namespace: namespace || 'default' } }
                  : { addressMatcher: { ip: '', toPorts: [{ port: '', protocol: 'TCP' }] } }
              )
            }
          />
        </Box>
        {useService ? (
          <FieldGrid>
            <NamespaceInput
              label={t('Service namespace')}
              required
              value={frontend.serviceMatcher?.namespace}
              onChange={v =>
                setFrontend({ serviceMatcher: { ...frontend.serviceMatcher, namespace: v || '' } })
              }
            />
            <NameAutocomplete
              // Service is one of Headlamp's built-in classes, always present.
              cls={coreClass('Service')!}
              namespace={frontend.serviceMatcher?.namespace}
              label={t('Service name')}
              required
              value={frontend.serviceMatcher?.serviceName}
              onChange={v =>
                setFrontend({
                  serviceMatcher: { ...frontend.serviceMatcher, serviceName: v || '' },
                })
              }
            />
          </FieldGrid>
        ) : (
          <>
            <Box sx={{ maxWidth: 420, mb: 2 }}>
              <TextInput
                label={t('IP address')}
                required
                placeholder="169.254.20.10"
                monospace
                value={frontend.addressMatcher?.ip}
                error={
                  frontend.addressMatcher?.ip && !isValidIP(frontend.addressMatcher.ip)
                    ? t('Not a valid IP address')
                    : undefined
                }
                onChange={v =>
                  setFrontend({ addressMatcher: { ...frontend.addressMatcher, ip: v || '' } })
                }
              />
            </Box>
            <RedirectPorts
              ports={frontend.addressMatcher?.toPorts}
              onChange={ports =>
                setFrontend({
                  addressMatcher: { ...frontend.addressMatcher, toPorts: ports || [] },
                })
              }
            />
          </>
        )}
      </FormSection>
      <FormSection
        title={t('Backend')}
        description={t(
          'Pods in the namespace of the policy that receive the traffic. Only pods on the same node as the client are used.'
        )}
        icon="mdi:export"
      >
        <LabelSelectorEditor
          label={t('Local endpoint selector')}
          emptyText={t('An empty selector matches every pod in the namespace.')}
          keySuggestions={['app', 'k8s-app', 'app.kubernetes.io/name']}
          value={value.spec?.redirectBackend?.localEndpointSelector || { matchLabels: {} }}
          onChange={v =>
            onChange(
              setIn(
                value,
                ['spec', 'redirectBackend', 'localEndpointSelector'],
                v || { matchLabels: {} }
              )
            )
          }
        />
        <Typography variant="subtitle2" sx={{ mt: 2, mb: 1 }}>
          {t('Backend ports')}
        </Typography>
        <RedirectPorts
          ports={value.spec?.redirectBackend?.toPorts}
          onChange={ports => onChange(setIn(value, ['spec', 'redirectBackend', 'toPorts'], ports))}
        />
        <Box sx={{ mt: 2 }}>
          <SwitchInput
            label={t('Skip redirect for traffic from the backend pods')}
            help={t(
              'Lets the backend itself reach the original frontend, e.g. a node-local DNS cache querying upstream.'
            )}
            {...bind(['spec', 'skipRedirectFromBackend'])}
          />
        </Box>
      </FormSection>
    </>
  );
}
