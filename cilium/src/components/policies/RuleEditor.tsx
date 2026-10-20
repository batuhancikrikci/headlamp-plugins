/**
 * Editors for the rules of a Cilium network policy. They are shared by the form and the wizard
 * and always edit plain rule objects, so the YAML tab shows exactly what was entered.
 */
import { Icon } from '@iconify/react';
import {
  Box,
  Button,
  Chip,
  IconButton,
  MenuItem,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import React from 'react';
import {
  ArrayEditor,
  FieldGrid,
  FormSection,
  SelectInput,
  StringListInput,
  SwitchInput,
  TextInput,
} from '../../common/form/Fields';
import { useText } from '../../common/i18n';
import {
  CIDRRule,
  Direction,
  DNSRule,
  EgressRule,
  ENTITIES,
  FQDNSelector,
  HTTPRule,
  ICMPRule,
  IngressRule,
  PolicyRule,
  PortProtocol,
  PortRule,
  ServiceSelector,
} from '../../resources/networkPolicy';
import { crd } from '../../resources/registry';
import { LabelSelector, Protocol } from '../../resources/types';
import { NAMESPACE_LABEL } from '../../utils/policyMatch';
import { isValidFQDNName, isValidFQDNPattern, isValidPolicyPort } from '../../utils/validation';
import {
  CIDRListInput,
  LabelSelectorEditor,
  NameAutocomplete,
  NamespaceInput,
} from '../common/form/SelectorEditor';

type AnyRule = IngressRule & EgressRule;

/** Returns a copy with `key` set, or removed when the value is empty. */
export function withField<T extends object, K extends keyof T>(obj: T, key: K, value: T[K]): T {
  const next = { ...obj };
  const empty =
    value === undefined || value === null || (Array.isArray(value) && value.length === 0);
  if (empty) delete next[key];
  else next[key] = value;
  return next;
}

const PROTOCOLS: Protocol[] = ['TCP', 'UDP', 'SCTP', 'ANY'];
const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

function PortRows({
  ports,
  onChange,
}: {
  ports: PortProtocol[] | undefined;
  onChange: (ports: PortProtocol[] | undefined) => void;
}) {
  const { t } = useText();
  const list = ports || [];
  const update = (index: number, patch: Partial<PortProtocol>) =>
    onChange(list.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  return (
    <Box>
      {list.map((port, index) => (
        // eslint-disable-next-line react/no-array-index-key
        <Box key={index} sx={{ display: 'flex', gap: 1, mb: 1, alignItems: 'flex-start' }}>
          <TextField
            size="small"
            sx={{ flex: 1 }}
            label={t('Port')}
            placeholder="443"
            value={port.port ?? ''}
            error={!!port.port && !isValidPolicyPort(port.port)}
            helperText={
              port.port && !isValidPolicyPort(port.port) ? t('Number or named port') : undefined
            }
            onChange={e => update(index, { port: e.target.value.trim() })}
          />
          <TextField
            size="small"
            type="number"
            sx={{ width: 130 }}
            label={t('End port')}
            value={port.endPort ?? ''}
            onChange={e =>
              update(index, { endPort: e.target.value === '' ? undefined : Number(e.target.value) })
            }
          />
          <TextField
            select
            size="small"
            sx={{ width: 110 }}
            label={t('Protocol')}
            value={port.protocol || 'TCP'}
            onChange={e => update(index, { protocol: e.target.value as Protocol })}
          >
            {PROTOCOLS.map(p => (
              <MenuItem key={p} value={p}>
                {p}
              </MenuItem>
            ))}
          </TextField>
          <Tooltip title={t('Remove')}>
            <IconButton
              size="small"
              sx={{ mt: 0.5 }}
              aria-label={t('Remove')}
              onClick={() => {
                const next = list.filter((_, i) => i !== index);
                onChange(next.length ? next : undefined);
              }}
            >
              <Icon icon="mdi:delete-outline" />
            </IconButton>
          </Tooltip>
        </Box>
      ))}
      <Button
        size="small"
        startIcon={<Icon icon="mdi:plus" />}
        onClick={() => onChange([...list, { port: '', protocol: 'TCP' }])}
      >
        {t('Add port')}
      </Button>
    </Box>
  );
}

type L7Kind = 'none' | 'http' | 'dns' | 'other';

function l7Kind(rule: PortRule): L7Kind {
  const rules = rule.rules;
  if (!rules) return 'none';
  if (rules.http) return 'http';
  if (rules.dns) return 'dns';
  return 'other';
}

function HTTPRuleRow({ rule, onChange }: { rule: HTTPRule; onChange: (next: HTTPRule) => void }) {
  const { t } = useText();
  return (
    <FieldGrid columns={3}>
      <SelectInput
        label={t('Method')}
        options={HTTP_METHODS}
        value={rule.method}
        onChange={v => onChange(withField(rule, 'method', v))}
        helperText={t('Empty allows any method')}
      />
      <TextInput
        label={t('Path (regex)')}
        placeholder="/api/v1/.*"
        monospace
        value={rule.path}
        onChange={v => onChange(withField(rule, 'path', v))}
      />
      <TextInput
        label={t('Host (regex)')}
        placeholder="api\.example\.com"
        monospace
        value={rule.host}
        onChange={v => onChange(withField(rule, 'host', v))}
      />
      <StringListInput
        label={t('Required headers')}
        placeholder="X-Token: secret"
        value={rule.headers}
        onChange={v => onChange(withField(rule, 'headers', v))}
      />
    </FieldGrid>
  );
}

function dnsNames(rules: DNSRule[] | undefined, key: keyof DNSRule): string[] {
  return (rules || []).map(r => r[key]).filter((v): v is string => !!v);
}

function PortRuleEditor({
  rule,
  onChange,
  deny,
}: {
  rule: PortRule;
  onChange: (next: PortRule) => void;
  deny: boolean;
}) {
  const { t } = useText();
  const kind = l7Kind(rule);
  const setKind = (next: L7Kind) => {
    if (next === 'none') onChange(withField(rule, 'rules', undefined));
    else if (next === 'http') onChange({ ...rule, rules: { http: [{}] } });
    else if (next === 'dns') onChange({ ...rule, rules: { dns: [{ matchPattern: '*' }] } });
  };
  const setDNS = (names: string[], patterns: string[]) =>
    onChange({
      ...rule,
      rules: {
        dns: [
          ...names.map(matchName => ({ matchName })),
          ...patterns.map(matchPattern => ({ matchPattern })),
        ],
      },
    });

  return (
    <Box>
      <PortRows ports={rule.ports} onChange={ports => onChange(withField(rule, 'ports', ports))} />
      {!deny && (
        <Box sx={{ mt: 2 }}>
          <Box sx={{ maxWidth: 320, mb: kind === 'none' ? 0 : 2 }}>
            <SelectInput
              label={t('L7 rules')}
              allowEmpty={false}
              options={[
                { value: 'none', label: t('None (L4 only)') },
                { value: 'http', label: 'HTTP' },
                { value: 'dns', label: 'DNS' },
                ...(kind === 'other' ? [{ value: 'other', label: t('Other (edit as YAML)') }] : []),
              ]}
              value={kind}
              onChange={v => setKind((v as L7Kind) || 'none')}
              help={t(
                'L7 rules send the traffic through the Cilium proxy and only allow the listed requests.'
              )}
            />
          </Box>
          {kind === 'http' && (
            <ArrayEditor<HTTPRule>
              items={rule.rules?.http}
              onChange={http => onChange({ ...rule, rules: { http: http || [{}] } })}
              newItem={() => ({})}
              addLabel={t('Add HTTP rule')}
              itemTitle={(_, i) => t('HTTP rule #{{index}}', { index: i + 1 })}
              minItems={1}
              renderItem={(http, update) => <HTTPRuleRow rule={http} onChange={update} />}
            />
          )}
          {kind === 'dns' && (
            <FieldGrid>
              <StringListInput
                label={t('Allowed DNS names')}
                placeholder="api.example.com"
                value={dnsNames(rule.rules?.dns, 'matchName')}
                validateItem={isValidFQDNName}
                onChange={v => setDNS(v || [], dnsNames(rule.rules?.dns, 'matchPattern'))}
              />
              <StringListInput
                label={t('Allowed DNS patterns')}
                placeholder="*.example.com"
                value={dnsNames(rule.rules?.dns, 'matchPattern')}
                validateItem={isValidFQDNPattern}
                helperText={t('Use * to allow (and observe) every lookup')}
                onChange={v => setDNS(dnsNames(rule.rules?.dns, 'matchName'), v || [])}
              />
            </FieldGrid>
          )}
          {kind === 'other' && (
            <Typography variant="body2" color="text.secondary">
              {t('This port uses L7 rules the form does not cover; edit them in the YAML tab.')}
            </Typography>
          )}
        </Box>
      )}
    </Box>
  );
}

function CIDRSetEditor({ rule, onChange }: { rule: CIDRRule; onChange: (next: CIDRRule) => void }) {
  const { t } = useText();
  const useGroup = rule.cidrGroupRef !== undefined;
  return (
    <FieldGrid columns={3}>
      <SelectInput
        label={t('Source')}
        allowEmpty={false}
        options={[
          { value: 'cidr', label: 'CIDR' },
          { value: 'group', label: t('CIDR group') },
        ]}
        value={useGroup ? 'group' : 'cidr'}
        onChange={v => onChange(v === 'group' ? { cidrGroupRef: '' } : { cidr: '' })}
      />
      {useGroup ? (
        <NameAutocomplete
          cls={crd('CiliumCIDRGroup').cls}
          label={t('CIDR group')}
          required
          value={rule.cidrGroupRef}
          onChange={v => onChange({ ...rule, cidrGroupRef: v || '' })}
        />
      ) : (
        <TextInput
          label="CIDR"
          required
          placeholder="10.0.0.0/8"
          monospace
          value={rule.cidr}
          onChange={v => onChange({ ...rule, cidr: v || '' })}
        />
      )}
      <CIDRListInput
        label={t('Except')}
        value={rule.except}
        onChange={v => onChange(withField(rule, 'except', v))}
        help={t('Sub-ranges of the CIDR that are excluded from the rule.')}
      />
    </FieldGrid>
  );
}

function fqdnValues(list: FQDNSelector[] | undefined, key: keyof FQDNSelector): string[] {
  return (list || []).map(f => f[key]).filter((v): v is string => !!v);
}

function icmpTypes(icmps: ICMPRule[] | undefined, family: 'IPv4' | 'IPv6'): string[] {
  return (icmps || [])
    .flatMap(i => i.fields || [])
    .filter(f => (f.family || 'IPv4') === family)
    .map(f => String(f.type));
}

function buildICMP(v4: string[], v6: string[]): ICMPRule[] | undefined {
  const toType = (value: string) => (/^\d+$/.test(value) ? Number(value) : value);
  const fields = [
    ...v4.map(type => ({ family: 'IPv4' as const, type: toType(type) })),
    ...v6.map(type => ({ family: 'IPv6' as const, type: toType(type) })),
  ];
  return fields.length ? [{ fields }] : undefined;
}

function SubTitle({ icon, children }: React.PropsWithChildren<{ icon: string }>) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mt: 2, mb: 1 }}>
      <Box sx={{ color: 'text.secondary', display: 'flex' }}>
        <Icon icon={icon} width={18} />
      </Box>
      <Typography variant="subtitle2">{children}</Typography>
    </Box>
  );
}

/** Editor for one ingress or egress rule (allow or deny). */
export function DirectionRuleEditor({
  rule,
  onChange,
  direction,
  deny,
  namespace,
}: {
  rule: AnyRule;
  onChange: (next: AnyRule) => void;
  direction: Direction;
  deny: boolean;
  /** Namespace of a namespaced policy; peers are implicitly limited to it. */
  namespace?: string;
}) {
  const { t } = useText();
  const ingress = direction === 'ingress';
  const endpointsKey = ingress ? 'fromEndpoints' : 'toEndpoints';
  const entitiesKey = ingress ? 'fromEntities' : 'toEntities';
  const cidrKey = ingress ? 'fromCIDR' : 'toCIDR';
  const cidrSetKey = ingress ? 'fromCIDRSet' : 'toCIDRSet';
  const fqdns = rule.toFQDNs;

  const setFQDNs = (names: string[], patterns: string[]) =>
    onChange(
      withField(rule, 'toFQDNs', [
        ...names.map(matchName => ({ matchName })),
        ...patterns.map(matchPattern => ({ matchPattern })),
      ])
    );

  return (
    <Box>
      <SubTitle icon="mdi:cube-outline">
        {ingress ? t('From endpoints') : t('To endpoints')}
      </SubTitle>
      <ArrayEditor<LabelSelector>
        items={rule[endpointsKey]}
        onChange={v => onChange(withField(rule, endpointsKey, v))}
        newItem={() => ({ matchLabels: {} })}
        addLabel={t('Add endpoint selector')}
        itemTitle={(_, i) => t('Endpoint selector #{{index}}', { index: i + 1 })}
        renderItem={(selector, update) => (
          <LabelSelectorEditor
            label={t('Labels')}
            value={selector}
            onChange={next => update(next || { matchLabels: {} })}
            keySuggestions={['app', 'app.kubernetes.io/name', `k8s:${NAMESPACE_LABEL}`]}
            emptyText={
              namespace
                ? t('An empty selector matches every endpoint in namespace {{namespace}}.', {
                    namespace,
                  })
                : t('An empty selector matches every endpoint in the cluster.')
            }
            help={
              namespace
                ? t(
                    'Selectors only match endpoints in the policy namespace unless they include the label k8s:io.kubernetes.pod.namespace.'
                  )
                : undefined
            }
          />
        )}
      />

      <SubTitle icon="mdi:earth">{t('Entities and CIDRs')}</SubTitle>
      <FieldGrid>
        <StringListInput
          label={ingress ? t('From entities') : t('To entities')}
          suggestions={ENTITIES}
          value={rule[entitiesKey]}
          validateItem={v => (ENTITIES as string[]).includes(v)}
          onChange={v => onChange(withField(rule, entitiesKey, v as AnyRule[typeof entitiesKey]))}
          help={t(
            'Well-known peers: world (outside the cluster), cluster, host, remote-node, kube-apiserver, ingress, health.'
          )}
        />
        <CIDRListInput
          allowIP
          label={ingress ? t('From CIDRs') : t('To CIDRs')}
          value={rule[cidrKey]}
          onChange={v => onChange(withField(rule, cidrKey, v))}
        />
      </FieldGrid>
      <Box sx={{ mt: 1.5 }}>
        <ArrayEditor<CIDRRule>
          items={rule[cidrSetKey]}
          onChange={v => onChange(withField(rule, cidrSetKey, v))}
          newItem={() => ({ cidr: '' })}
          addLabel={t('Add CIDR with exceptions or CIDR group')}
          itemTitle={(set, i) =>
            set.cidrGroupRef !== undefined
              ? t('CIDR group #{{index}}', { index: i + 1 })
              : t('CIDR #{{index}}', { index: i + 1 })
          }
          renderItem={(set, update) => <CIDRSetEditor rule={set} onChange={update} />}
        />
      </Box>

      {!ingress && (
        <>
          <SubTitle icon="mdi:web">{t('DNS names and services')}</SubTitle>
          {!deny && (
            <FieldGrid>
              <StringListInput
                label={t('To FQDNs (exact names)')}
                placeholder="api.example.com"
                value={fqdnValues(fqdns, 'matchName')}
                validateItem={isValidFQDNName}
                onChange={v => setFQDNs(v || [], fqdnValues(fqdns, 'matchPattern'))}
                help={t(
                  'FQDN rules need a DNS rule that lets Cilium observe the lookups, and cannot be combined with other destinations in the same rule.'
                )}
              />
              <StringListInput
                label={t('To FQDNs (patterns)')}
                placeholder="*.example.com"
                value={fqdnValues(fqdns, 'matchPattern')}
                validateItem={isValidFQDNPattern}
                onChange={v => setFQDNs(fqdnValues(fqdns, 'matchName'), v || [])}
              />
            </FieldGrid>
          )}
          <Box sx={{ mt: 1.5 }}>
            <ArrayEditor<ServiceSelector>
              items={rule.toServices}
              onChange={v => onChange(withField(rule, 'toServices', v))}
              newItem={() => ({
                k8sService: { serviceName: '', namespace: namespace || 'default' },
              })}
              addLabel={t('Add service')}
              itemTitle={(_, i) => t('Service #{{index}}', { index: i + 1 })}
              renderItem={(service, update) =>
                service.k8sService ? (
                  <FieldGrid>
                    <TextInput
                      label={t('Service name')}
                      required
                      value={service.k8sService.serviceName}
                      onChange={v =>
                        update({ k8sService: { ...service.k8sService, serviceName: v || '' } })
                      }
                    />
                    <NamespaceInput
                      label={t('Namespace')}
                      value={service.k8sService.namespace}
                      onChange={v =>
                        update({ k8sService: withField(service.k8sService!, 'namespace', v) })
                      }
                    />
                  </FieldGrid>
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    {t('This entry selects services by label; edit it in the YAML tab.')}
                  </Typography>
                )
              }
            />
          </Box>
        </>
      )}

      <SubTitle icon="mdi:ethernet">{t('Ports')}</SubTitle>
      <ArrayEditor<PortRule>
        items={rule.toPorts}
        onChange={v => onChange(withField(rule, 'toPorts', v))}
        newItem={() => ({ ports: [{ port: '', protocol: 'TCP' }] })}
        addLabel={t('Add ports')}
        itemTitle={(_, i) => t('Port set #{{index}}', { index: i + 1 })}
        emptyText={t('No ports: the rule applies to all ports and protocols.')}
        renderItem={(portRule, update) => (
          <PortRuleEditor rule={portRule} onChange={update} deny={deny} />
        )}
      />

      <SubTitle icon="mdi:access-point">{t('ICMP and authentication')}</SubTitle>
      <FieldGrid columns={3}>
        <StringListInput
          label={t('ICMPv4 types')}
          placeholder="8"
          suggestions={['8', '0', '3', '11', 'EchoRequest', 'EchoReply']}
          value={icmpTypes(rule.icmps, 'IPv4')}
          onChange={v =>
            onChange(withField(rule, 'icmps', buildICMP(v || [], icmpTypes(rule.icmps, 'IPv6'))))
          }
        />
        <StringListInput
          label={t('ICMPv6 types')}
          placeholder="128"
          suggestions={['128', '129', 'EchoRequest', 'EchoReply']}
          value={icmpTypes(rule.icmps, 'IPv6')}
          onChange={v =>
            onChange(withField(rule, 'icmps', buildICMP(icmpTypes(rule.icmps, 'IPv4'), v || [])))
          }
        />
        {!deny && (
          <SelectInput
            label={t('Mutual authentication')}
            options={[
              { value: 'required', label: t('Required') },
              { value: 'disabled', label: t('Disabled') },
            ]}
            value={rule.authentication?.mode}
            onChange={v =>
              onChange(
                withField(
                  rule,
                  'authentication',
                  v ? { mode: v as 'required' | 'disabled' } : undefined
                )
              )
            }
          />
        )}
      </FieldGrid>
    </Box>
  );
}

/** Ready-made rules offered as one-click additions in the form and the wizard. */
export interface RulePreset {
  id: string;
  label: string;
  icon: string;
  rule: () => AnyRule;
}

type T = (key: string, params?: Record<string, unknown>) => string;

export function rulePresets(direction: Direction, t: T, namespaced: boolean): RulePreset[] {
  if (direction === 'ingress') {
    return [
      {
        id: 'same-namespace',
        label: namespaced ? t('From the same namespace') : t('From all endpoints'),
        icon: 'mdi:cube-outline',
        rule: () => ({ fromEndpoints: [{}] }),
      },
      {
        id: 'ingress',
        label: t('From the ingress / gateway'),
        icon: 'mdi:gate',
        rule: () => ({ fromEntities: ['ingress'] }),
      },
      {
        id: 'cluster',
        label: t('From inside the cluster'),
        icon: 'mdi:kubernetes',
        rule: () => ({ fromEntities: ['cluster'] }),
      },
      {
        id: 'world',
        label: t('From outside the cluster'),
        icon: 'mdi:earth',
        rule: () => ({ fromEntities: ['world'] }),
      },
      {
        id: 'health',
        label: t('From the node (kubelet probes)'),
        icon: 'mdi:heart-pulse',
        rule: () => ({ fromEntities: ['host', 'remote-node'] }),
      },
    ];
  }
  return [
    {
      id: 'dns',
      label: t('DNS to kube-dns'),
      icon: 'mdi:dns-outline',
      rule: () => ({
        toEndpoints: [
          {
            matchLabels: {
              [`k8s:${NAMESPACE_LABEL}`]: 'kube-system',
              'k8s:k8s-app': 'kube-dns',
            },
          },
        ],
        toPorts: [
          {
            ports: [
              { port: '53', protocol: 'UDP' },
              { port: '53', protocol: 'TCP' },
            ],
            rules: { dns: [{ matchPattern: '*' }] },
          },
        ],
      }),
    },
    {
      id: 'same-namespace',
      label: namespaced ? t('To the same namespace') : t('To all endpoints'),
      icon: 'mdi:cube-outline',
      rule: () => ({ toEndpoints: [{}] }),
    },
    {
      id: 'apiserver',
      label: t('To the Kubernetes API server'),
      icon: 'mdi:api',
      rule: () => ({ toEntities: ['kube-apiserver'] }),
    },
    {
      id: 'fqdn',
      label: t('To a DNS name (HTTPS)'),
      icon: 'mdi:web',
      rule: () => ({
        toFQDNs: [{ matchName: 'example.com' }],
        toPorts: [{ ports: [{ port: '443', protocol: 'TCP' }] }],
      }),
    },
    {
      id: 'world',
      label: t('To outside the cluster'),
      icon: 'mdi:earth',
      rule: () => ({ toEntities: ['world'] }),
    },
  ];
}

/** List of allow or deny rules of one direction, with one-click presets. */
export function DirectionRules({
  rules,
  onChange,
  direction,
  deny,
  namespace,
  namespaced,
}: {
  rules: AnyRule[] | undefined;
  onChange: (next: AnyRule[] | undefined) => void;
  direction: Direction;
  deny: boolean;
  namespace?: string;
  namespaced: boolean;
}) {
  const { t } = useText();
  const ingress = direction === 'ingress';
  return (
    <Box>
      <ArrayEditor<AnyRule>
        items={rules}
        onChange={onChange}
        newItem={() => ({})}
        addLabel={deny ? t('Add empty deny rule') : t('Add empty rule')}
        itemTitle={(_, i) =>
          deny
            ? t('{{direction}} deny rule #{{index}}', {
                direction: ingress ? t('Ingress') : t('Egress'),
                index: i + 1,
              })
            : t('{{direction}} rule #{{index}}', {
                direction: ingress ? t('Ingress') : t('Egress'),
                index: i + 1,
              })
        }
        renderItem={(rule, update) => (
          <DirectionRuleEditor
            rule={rule}
            onChange={update}
            direction={direction}
            deny={deny}
            namespace={namespace}
          />
        )}
      />
      {!deny && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mt: 1, alignItems: 'center' }}>
          <Typography variant="caption" color="text.secondary">
            {t('Quick add:')}
          </Typography>
          {rulePresets(direction, t, namespaced).map(preset => (
            <Chip
              key={preset.id}
              size="small"
              variant="outlined"
              icon={<Icon icon={preset.icon} width={16} />}
              label={preset.label}
              onClick={() => onChange([...(rules || []), preset.rule()])}
            />
          ))}
        </Box>
      )}
    </Box>
  );
}

/** Editor for a complete rule: who is selected and what is allowed or denied. */
export function PolicyRuleEditor({
  rule,
  onChange,
  clusterwide,
  namespace,
}: {
  rule: PolicyRule;
  onChange: (next: PolicyRule) => void;
  clusterwide: boolean;
  namespace?: string;
}) {
  const { t } = useText();
  const nodeScope = rule.nodeSelector !== undefined && rule.nodeSelector !== null;
  const setScope = (scope: 'endpoints' | 'nodes') => {
    const next = { ...rule };
    delete next.endpointSelector;
    delete next.nodeSelector;
    if (scope === 'nodes') next.nodeSelector = { matchLabels: {} };
    else next.endpointSelector = { matchLabels: {} };
    onChange(next);
  };
  const deny = rule.enableDefaultDeny;
  const setDefaultDeny = (key: 'ingress' | 'egress', enabled: boolean) => {
    const next = { ...(deny || {}) };
    if (enabled) delete next[key];
    else next[key] = false;
    onChange(withField(rule, 'enableDefaultDeny', Object.keys(next).length ? next : undefined));
  };

  return (
    <>
      <FormSection
        title={t('Applies to')}
        description={
          nodeScope
            ? t('Host policy: the rules apply to the nodes matched by the selector.')
            : t('The endpoints (pods) this policy protects.')
        }
        icon="mdi:target"
        action={
          clusterwide && (
            <ToggleButtonGroup
              size="small"
              exclusive
              value={nodeScope ? 'nodes' : 'endpoints'}
              onChange={(_, v) => v && setScope(v)}
              aria-label={t('Policy scope')}
            >
              <ToggleButton value="endpoints">{t('Endpoints')}</ToggleButton>
              <ToggleButton value="nodes">{t('Nodes')}</ToggleButton>
            </ToggleButtonGroup>
          )
        }
      >
        {nodeScope ? (
          <LabelSelectorEditor
            label={t('Node selector')}
            value={rule.nodeSelector}
            onChange={v => onChange({ ...rule, nodeSelector: v || { matchLabels: {} } })}
            keySuggestions={['kubernetes.io/hostname', 'node-role.kubernetes.io/control-plane']}
            emptyText={t('An empty selector matches every node.')}
          />
        ) : (
          <LabelSelectorEditor
            label={t('Endpoint selector')}
            value={rule.endpointSelector || { matchLabels: {} }}
            onChange={v => onChange({ ...rule, endpointSelector: v || { matchLabels: {} } })}
            keySuggestions={['app', 'app.kubernetes.io/name', 'app.kubernetes.io/component']}
            emptyText={
              namespace
                ? t('An empty selector matches every endpoint in namespace {{namespace}}.', {
                    namespace,
                  })
                : t('An empty selector matches every endpoint in the cluster.')
            }
          />
        )}
        <Box sx={{ mt: 2 }}>
          <TextInput
            label={t('Description')}
            value={rule.description}
            onChange={v => onChange(withField(rule, 'description', v))}
          />
        </Box>
      </FormSection>

      <FormSection
        title={t('Ingress')}
        description={t('Traffic that is allowed to reach the selected endpoints.')}
        icon="mdi:arrow-collapse-right"
      >
        <DirectionRules
          rules={rule.ingress}
          onChange={v => onChange(withField(rule, 'ingress', v))}
          direction="ingress"
          deny={false}
          namespace={namespace}
          namespaced={!clusterwide}
        />
        <SubTitle icon="mdi:cancel">{t('Ingress deny rules')}</SubTitle>
        <DirectionRules
          rules={rule.ingressDeny}
          onChange={v => onChange(withField(rule, 'ingressDeny', v))}
          direction="ingress"
          deny
          namespace={namespace}
          namespaced={!clusterwide}
        />
      </FormSection>

      <FormSection
        title={t('Egress')}
        description={t('Traffic the selected endpoints are allowed to send.')}
        icon="mdi:arrow-expand-right"
      >
        <DirectionRules
          rules={rule.egress}
          onChange={v => onChange(withField(rule, 'egress', v))}
          direction="egress"
          deny={false}
          namespace={namespace}
          namespaced={!clusterwide}
        />
        <SubTitle icon="mdi:cancel">{t('Egress deny rules')}</SubTitle>
        <DirectionRules
          rules={rule.egressDeny}
          onChange={v => onChange(withField(rule, 'egressDeny', v))}
          direction="egress"
          deny
          namespace={namespace}
          namespaced={!clusterwide}
        />
      </FormSection>

      <FormSection
        title={t('Default deny')}
        description={t(
          'A policy with rules for a direction normally denies all other traffic in that direction. Switch this off to add rules without restricting anything else.'
        )}
        icon="mdi:shield-off-outline"
      >
        <FieldGrid>
          <SwitchInput
            label={t('Default deny for ingress')}
            value={deny?.ingress !== false}
            onChange={v => setDefaultDeny('ingress', !!v)}
          />
          <SwitchInput
            label={t('Default deny for egress')}
            value={deny?.egress !== false}
            onChange={v => setDefaultDeny('egress', !!v)}
          />
        </FieldGrid>
      </FormSection>
    </>
  );
}
