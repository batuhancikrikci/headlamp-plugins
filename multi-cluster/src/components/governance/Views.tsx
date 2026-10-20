/**
 * Governance views: root policies with their compliance across clusters, policy sets, placement
 * bindings, policy automations, and the configuration / operator policies evaluated on this
 * cluster (when the hub is itself managed).
 */
import { DateLabel, SectionBox } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Alert, Box, Button, Chip, Typography } from '@mui/material';
import React from 'react';
import { CodeBlock } from '../../common/CodeBlock';
import { useText } from '../../common/i18n';
import { dumpAllYaml, dumpYaml } from '../../common/yaml';
import { useOcmList } from '../../hooks/useOcmList';
import { KubeJson } from '../../resources/models/common';
import {
  annotationList,
  bindingsOf,
  clusterCompliance,
  compliance,
  complianceHealth,
  isReplicatedPolicy,
  latestMessages,
  PlacementBindingJson,
  POLICY_ANNOTATIONS,
  PolicyAutomationJson,
  PolicyJson,
  PolicySetJson,
  remediationOf,
  replicasOf,
  rootPolicyOf,
  setsContaining,
  templateSummaries,
  toPolicyGenerator,
} from '../../resources/models/policy';
import { crd } from '../../resources/registry';
import { col, RelatedTable } from '../common/Related';
import { ClusterLink, ResourceRefLink } from '../common/ResourceRefLink';
import { Bar, HealthLabel, StringArray } from '../common/Shared';
import { OcmDetailView, OcmListView } from '../common/Views';
import { PolicyActions } from './Actions';

export function ComplianceLabel({ value }: { value?: string }) {
  const { t } = useText();
  return <HealthLabel health={complianceHealth(value)} label={value || t('No status')} />;
}

function RemediationChip({ policy }: { policy: PolicyJson }) {
  const { t } = useText();
  const r = remediationOf(policy);
  if (!r)
    return (
      <Typography variant="body2" color="text.secondary">
        {t('per template')}
      </Typography>
    );
  return (
    <Chip
      size="small"
      variant="outlined"
      color={r === 'enforce' ? 'warning' : 'default'}
      label={r === 'enforce' ? t('Enforce') : t('Inform')}
    />
  );
}

function ClustersBar({ policy }: { policy: PolicyJson }) {
  const c = clusterCompliance(policy);
  if (c.total === 0) return <>-</>;
  return (
    <Box sx={{ minWidth: 120 }}>
      <Bar value={c.compliant} total={c.total} tone={c.nonCompliant > 0 ? 'error' : 'success'} />
      <Typography variant="caption" color="text.secondary">
        {c.compliant}/{c.total}
      </Typography>
    </Box>
  );
}

export function PolicyList() {
  const { t } = useText();
  return (
    <OcmListView
      info={crd('Policy')}
      filterFunction={item => !isReplicatedPolicy(item.jsonData)}
      notice={
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          {t(
            'Root policies only. The copies the propagator creates in each cluster namespace are shown on the policy and cluster pages.'
          )}
        </Typography>
      }
      columns={[
        col<PolicyJson>(
          'compliance',
          t('Compliance'),
          j => compliance(j),
          j => <ComplianceLabel value={compliance(j)} />
        ),
        col<PolicyJson>(
          'remediation',
          t('Remediation'),
          j => remediationOf(j),
          j => <RemediationChip policy={j} />
        ),
        col<PolicyJson>(
          'clusters',
          t('Compliant clusters'),
          j => clusterCompliance(j).compliant,
          j => <ClustersBar policy={j} />
        ),
        col<PolicyJson>(
          'templates',
          t('Templates'),
          j =>
            templateSummaries(j)
              .map(s => s.kind)
              .join(', '),
          j => <StringArray items={Array.from(new Set(templateSummaries(j).map(s => s.kind)))} />
        ),
        col<PolicyJson>('standards', t('Standards'), j =>
          annotationList(j, POLICY_ANNOTATIONS.standards).join(', ')
        ),
        col<PolicyJson>('disabled', t('Enabled'), j => (j.spec?.disabled ? t('No') : t('Yes'))),
      ]}
    />
  );
}

type ClusterStatus = NonNullable<NonNullable<PolicyJson['status']>['status']>[number];

/** Compliance per cluster, with the latest message of each cluster's replicated policy. */
function PolicyClusters({ policy }: { policy: PolicyJson }) {
  const { t } = useText();
  const all = useOcmList<PolicyJson>('Policy', {
    labelSelector: `policy.open-cluster-management.io/root-policy=${policy.metadata.namespace}.${policy.metadata.name}`,
  });
  const replicas = all.items ? replicasOf(policy, all.items) : [];
  const message = (cluster?: string) => {
    const r = replicas.find(p => p.metadata.namespace === cluster);
    if (!r) return undefined;
    return latestMessages(r)
      .filter(m => m.message)
      .map(m => `${m.template}: ${m.message}`)
      .join('\n');
  };
  return (
    <RelatedTable
      title={t('Compliance per cluster')}
      items={policy.status?.status || []}
      what={t('policies')}
      emptyMessage={t('The policy is not placed on any cluster (check its placement binding).')}
      columns={[
        {
          label: t('Cluster'),
          getter: (s: ClusterStatus) =>
            s.clustername ? <ClusterLink name={s.clustername} /> : '-',
        },
        {
          label: t('Compliance'),
          getter: (s: ClusterStatus) => <ComplianceLabel value={s.compliant} />,
        },
        {
          label: t('Latest message'),
          getter: (s: ClusterStatus) => (
            <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {message(s.clusternamespace) || '-'}
            </Typography>
          ),
        },
        {
          label: t('Cluster copy'),
          getter: (s: ClusterStatus) =>
            s.clusternamespace ? (
              <ResourceRefLink
                kind="Policy"
                name={`${policy.metadata.namespace}.${policy.metadata.name}`}
                namespace={s.clusternamespace}
              />
            ) : (
              '-'
            ),
        },
      ]}
    />
  );
}

type PlacementStatus = NonNullable<NonNullable<PolicyJson['status']>['placement']>[number];

function PolicyPlacement({ policy }: { policy: PolicyJson }) {
  const { t } = useText();
  const bindings = useOcmList<PlacementBindingJson>('PlacementBinding', {
    namespace: policy.metadata.namespace,
  });
  const sets = useOcmList<PolicySetJson>('PolicySet', { namespace: policy.metadata.namespace });
  const ns = policy.metadata.namespace;
  const status = policy.status?.placement || [];
  const own = bindings.items ? bindingsOf(policy, bindings.items, sets.items || []) : null;
  return (
    <>
      <RelatedTable
        title={t('Placement')}
        description={t(
          'Bindings that place this policy, directly or through a policy set, and the clusters their placements selected.'
        )}
        items={status}
        what={t('placement bindings')}
        emptyMessage={
          own && own.length > 0
            ? t('Bound, but the placement has not selected any cluster yet.')
            : t('No PlacementBinding binds this policy; it is not delivered to any cluster.')
        }
        columns={[
          {
            label: t('Binding'),
            getter: (p: PlacementStatus) =>
              p.placementBinding ? (
                <ResourceRefLink kind="PlacementBinding" name={p.placementBinding} namespace={ns} />
              ) : (
                '-'
              ),
          },
          {
            label: t('Placement'),
            getter: (p: PlacementStatus) =>
              p.placement ? (
                <ResourceRefLink kind="Placement" name={p.placement} namespace={ns} />
              ) : p.placementRule ? (
                <ResourceRefLink
                  kind="PlacementRule"
                  name={p.placementRule}
                  namespace={ns}
                  showKind
                />
              ) : (
                '-'
              ),
          },
          {
            label: t('Through policy set'),
            getter: (p: PlacementStatus) =>
              p.policySet ? (
                <ResourceRefLink kind="PolicySet" name={p.policySet} namespace={ns} />
              ) : (
                '-'
              ),
          },
          {
            label: t('Clusters'),
            getter: (p: PlacementStatus) => (
              <StringArray items={(p.decisions || []).map(d => d.clusterName || '?')} />
            ),
          },
        ]}
      />
      {sets.items && setsContaining(policy, sets.items).length > 0 && (
        <SectionBox title={t('Policy sets')}>
          <Box sx={{ display: 'flex', flexWrap: 'wrap' }}>
            {setsContaining(policy, sets.items).map(s => (
              <ResourceRefLink
                key={s.metadata.name}
                kind="PolicySet"
                name={s.metadata.name}
                namespace={ns}
              />
            ))}
          </Box>
        </SectionBox>
      )}
    </>
  );
}

type TemplateRow = ReturnType<typeof templateSummaries>[number] & { index: number };

function PolicyTemplates({ policy, replica }: { policy: PolicyJson; replica: boolean }) {
  const { t } = useText();
  const [shown, setShown] = React.useState<number | null>(null);
  const templates = policy.spec?.['policy-templates'] || [];
  const messages = replica ? latestMessages(policy) : [];
  const rows: TemplateRow[] = templateSummaries(policy).map((s, index) => ({ ...s, index }));
  return (
    <SectionBox title={t('Policy templates')}>
      <RelatedTable
        title=""
        items={rows}
        what={t('templates')}
        emptyMessage={t('No templates.')}
        columns={[
          { label: t('Kind'), getter: (r: TemplateRow) => r.kind },
          { label: t('Name'), getter: (r: TemplateRow) => r.name },
          { label: t('Severity'), getter: (r: TemplateRow) => r.severity || '-' },
          { label: t('Remediation'), getter: (r: TemplateRow) => r.remediation || '-' },
          ...(replica
            ? [
                {
                  label: t('Status on this cluster'),
                  getter: (r: TemplateRow) => {
                    const m = messages.find(x => x.template === r.name);
                    return m ? (
                      <Box>
                        <ComplianceLabel value={m.compliant} />
                        <Typography
                          variant="caption"
                          component="div"
                          sx={{ wordBreak: 'break-word' }}
                        >
                          {m.message}
                        </Typography>
                      </Box>
                    ) : (
                      '-'
                    );
                  },
                },
              ]
            : []),
          {
            label: '',
            getter: (r: TemplateRow) => (
              <Button size="small" onClick={() => setShown(shown === r.index ? null : r.index)}>
                {shown === r.index ? t('Hide YAML') : t('YAML')}
              </Button>
            ),
          },
        ]}
      />
      {shown !== null && templates[shown] && (
        <Box sx={{ mt: 1 }}>
          <CodeBlock value={dumpYaml(templates[shown].objectDefinition)} maxHeight={420} />
        </Box>
      )}
    </SectionBox>
  );
}

/** Equivalent PolicyGenerator configuration, for GitOps repositories. */
function PolicyGeneratorExport({ policy }: { policy: PolicyJson }) {
  const { t } = useText();
  const [open, setOpen] = React.useState(false);
  const placement =
    (policy.status?.placement || []).find(p => p.placement)?.placement || '<placement>';
  const out = React.useMemo(() => toPolicyGenerator(policy, placement), [policy, placement]);
  return (
    <SectionBox
      title={t('PolicyGenerator export')}
      headerProps={{
        actions: [
          <Button key="toggle" size="small" variant="outlined" onClick={() => setOpen(o => !o)}>
            {open ? t('Hide') : t('Show')}
          </Button>,
        ],
      }}
    >
      <Typography variant="body2" color="text.secondary">
        {t(
          'PolicyGenerator is a kustomize generator (policy-generator-plugin), not a cluster resource. This is a configuration that renders this policy, for keeping it in Git.'
        )}
      </Typography>
      {open && (
        <Box sx={{ mt: 1.5 }}>
          <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
            policy-generator.yaml
          </Typography>
          <CodeBlock value={dumpYaml(out.generator)} maxHeight={360} />
          {out.manifests.map(m => (
            <Box key={m.path} sx={{ mt: 1.5 }}>
              <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                {m.path}
              </Typography>
              <CodeBlock value={dumpAllYaml(m.objects)} maxHeight={300} />
            </Box>
          ))}
        </Box>
      )}
    </SectionBox>
  );
}

function PolicyAutomations({ policy }: { policy: PolicyJson }) {
  const { t } = useText();
  const automations = useOcmList<PolicyAutomationJson>('PolicyAutomation', {
    namespace: policy.metadata.namespace,
  });
  if (automations.missing) return null;
  const own = automations.items
    ? automations.items.filter(a => a.spec?.policyRef === policy.metadata.name)
    : null;
  if (own && own.length === 0) return null;
  return (
    <RelatedTable
      title={t('Automations')}
      items={own}
      error={automations.error}
      what={t('policy automations')}
      emptyMessage="-"
      columns={[
        {
          label: t('Automation'),
          getter: (a: PolicyAutomationJson) => (
            <ResourceRefLink
              kind="PolicyAutomation"
              name={a.metadata.name}
              namespace={a.metadata.namespace}
            />
          ),
        },
        { label: t('Mode'), getter: (a: PolicyAutomationJson) => a.spec?.mode || '-' },
        {
          label: t('Ansible template'),
          getter: (a: PolicyAutomationJson) => a.spec?.automationDef?.name || '-',
        },
      ]}
    />
  );
}

export function PolicyDetail() {
  const { t } = useText();
  return (
    <OcmDetailView
      info={crd('Policy')}
      conditions={false}
      actions={item => [<PolicyActions key="policy-actions" item={item} />]}
      extraInfo={item => {
        const j = item.jsonData as PolicyJson;
        const root = rootPolicyOf(j);
        const c = clusterCompliance(j);
        return [
          { name: t('Compliance'), value: <ComplianceLabel value={compliance(j)} /> },
          {
            name: t('Root policy'),
            value: root ? (
              <ResourceRefLink
                kind="Policy"
                name={root.name}
                namespace={root.namespace}
                qualified
              />
            ) : (
              '-'
            ),
            hide: !root,
          },
          {
            name: t('Cluster'),
            value: (
              <ClusterLink
                name={
                  j.metadata.labels?.['policy.open-cluster-management.io/cluster-name'] ||
                  j.metadata.namespace ||
                  ''
                }
              />
            ),
            hide: !root,
          },
          { name: t('Remediation'), value: <RemediationChip policy={j} /> },
          { name: t('Enabled'), value: j.spec?.disabled ? t('No') : t('Yes') },
          {
            name: t('Clusters'),
            value: t(
              '{{compliant}} compliant · {{nonCompliant}} non-compliant · {{pending}} pending of {{total}}',
              c as unknown as Record<string, unknown>
            ),
            hide: !!root,
          },
          {
            name: t('Standards'),
            value: <StringArray items={annotationList(j, POLICY_ANNOTATIONS.standards)} />,
          },
          {
            name: t('Categories'),
            value: <StringArray items={annotationList(j, POLICY_ANNOTATIONS.categories)} />,
          },
          {
            name: t('Controls'),
            value: <StringArray items={annotationList(j, POLICY_ANNOTATIONS.controls)} />,
          },
          {
            name: t('Dependencies'),
            value: (
              <StringArray
                items={(j.spec?.dependencies || []).map(
                  d =>
                    `${d.kind || 'Policy'} ${d.namespace ? `${d.namespace}/` : ''}${d.name} = ${
                      d.compliance
                    }`
                )}
              />
            ),
            hide: !(j.spec?.dependencies || []).length,
          },
          {
            name: t('Hub template service account'),
            value: j.spec?.hubTemplateOptions?.serviceAccountName,
            hide: !j.spec?.hubTemplateOptions?.serviceAccountName,
          },
        ];
      }}
      sections={item => {
        const j = item.jsonData as PolicyJson;
        const replica = isReplicatedPolicy(j);
        return [
          ...(replica
            ? [
                {
                  id: 'mch-replica',
                  section: (
                    <Alert severity="info" sx={{ mb: 2 }}>
                      {t(
                        'This is the copy the propagator created for one cluster. Edit the root policy instead; changes here are overwritten.'
                      )}
                    </Alert>
                  ),
                },
              ]
            : [
                { id: 'mch-clusters', section: <PolicyClusters policy={j} /> },
                { id: 'mch-placement', section: <PolicyPlacement policy={j} /> },
              ]),
          { id: 'mch-templates', section: <PolicyTemplates policy={j} replica={replica} /> },
          ...(replica
            ? []
            : [
                { id: 'mch-automations', section: <PolicyAutomations policy={j} /> },
                { id: 'mch-generator', section: <PolicyGeneratorExport policy={j} /> },
              ]),
        ];
      }}
    />
  );
}

// ----- PolicySet -----

export function PolicySetList() {
  const { t } = useText();
  return (
    <OcmListView
      info={crd('PolicySet')}
      columns={[
        col<PolicySetJson>(
          'compliance',
          t('Compliance'),
          j => compliance(j),
          j => <ComplianceLabel value={compliance(j)} />
        ),
        col<PolicySetJson>('policies', t('Policies'), j => (j.spec?.policies || []).length),
        col<PolicySetJson>('description', t('Description'), j => j.spec?.description),
      ]}
    />
  );
}

function SetPolicies({ set }: { set: PolicySetJson }) {
  const { t } = useText();
  const policies = useOcmList<PolicyJson>('Policy', { namespace: set.metadata.namespace });
  const rows = (set.spec?.policies || []).map(name => ({
    name,
    policy: (policies.items || []).find(p => p.metadata.name === name && !isReplicatedPolicy(p)),
  }));
  return (
    <RelatedTable
      title={t('Policies in this set')}
      items={policies.items ? rows : null}
      error={policies.error}
      what={t('policies')}
      emptyMessage={t('The set contains no policies.')}
      columns={[
        {
          label: t('Policy'),
          getter: (r: { name: string }) => (
            <ResourceRefLink kind="Policy" name={r.name} namespace={set.metadata.namespace} />
          ),
        },
        {
          label: t('Compliance'),
          getter: (r: { policy?: PolicyJson }) =>
            r.policy ? (
              <ComplianceLabel value={compliance(r.policy)} />
            ) : (
              <HealthLabel health="error" label={t('Not found')} />
            ),
        },
        {
          label: t('Clusters'),
          getter: (r: { policy?: PolicyJson }) =>
            r.policy ? <ClustersBar policy={r.policy} /> : '-',
        },
      ]}
    />
  );
}

export function PolicySetDetail() {
  const { t } = useText();
  return (
    <OcmDetailView
      info={crd('PolicySet')}
      conditions={false}
      extraInfo={item => {
        const j = item.jsonData as PolicySetJson;
        return [
          { name: t('Compliance'), value: <ComplianceLabel value={compliance(j)} /> },
          {
            name: t('Status message'),
            value: j.status?.statusMessage,
            hide: !j.status?.statusMessage,
          },
          { name: t('Description'), value: j.spec?.description || '-' },
          {
            name: t('Placements'),
            value: (
              <Box sx={{ display: 'flex', flexWrap: 'wrap' }}>
                {(j.status?.placement || [])
                  .filter(p => p.placement)
                  .map(p => (
                    <ResourceRefLink
                      key={p.placement}
                      kind="Placement"
                      name={p.placement as string}
                      namespace={j.metadata.namespace}
                    />
                  ))}
              </Box>
            ),
          },
        ];
      }}
      sections={item => [
        { id: 'mch-set-policies', section: <SetPolicies set={item.jsonData as PolicySetJson} /> },
      ]}
    />
  );
}

// ----- PlacementBinding -----

function PlacementRefLink({ binding }: { binding: PlacementBindingJson }) {
  const ref = binding.placementRef;
  if (!ref?.name) return <>-</>;
  return (
    <ResourceRefLink
      kind={ref.kind === 'PlacementRule' ? 'PlacementRule' : 'Placement'}
      name={ref.name}
      namespace={binding.metadata.namespace}
      showKind={ref.kind === 'PlacementRule'}
    />
  );
}

export function PlacementBindingList() {
  const { t } = useText();
  return (
    <OcmListView
      info={crd('PlacementBinding')}
      columns={[
        col<PlacementBindingJson>(
          'placement',
          t('Placement'),
          j => j.placementRef?.name,
          j => <PlacementRefLink binding={j} />
        ),
        col<PlacementBindingJson>(
          'subjects',
          t('Subjects'),
          j => (j.subjects || []).map(s => `${s.kind}/${s.name}`).join(', '),
          j => <StringArray items={(j.subjects || []).map(s => `${s.kind}/${s.name}`)} />
        ),
        col<PlacementBindingJson>(
          'override',
          t('Remediation override'),
          j => j.bindingOverrides?.remediationAction
        ),
      ]}
    />
  );
}

export function PlacementBindingDetail() {
  const { t } = useText();
  return (
    <OcmDetailView
      info={crd('PlacementBinding')}
      conditions={false}
      extraInfo={item => {
        const j = item.jsonData as PlacementBindingJson;
        return [
          { name: t('Placement'), value: <PlacementRefLink binding={j} /> },
          {
            name: t('Subjects'),
            value: (
              <Box sx={{ display: 'flex', flexWrap: 'wrap' }}>
                {(j.subjects || []).map(s => (
                  <ResourceRefLink
                    key={`${s.kind}/${s.name}`}
                    kind={s.kind === 'PolicySet' ? 'PolicySet' : 'Policy'}
                    name={s.name || '?'}
                    namespace={j.metadata.namespace}
                    showKind
                  />
                ))}
              </Box>
            ),
          },
          { name: t('Remediation override'), value: j.bindingOverrides?.remediationAction || '-' },
          { name: t('Sub-filter'), value: j.subFilter || '-', hide: !j.subFilter },
        ];
      }}
    />
  );
}

// ----- PolicyAutomation -----

export function PolicyAutomationList() {
  const { t } = useText();
  return (
    <OcmListView
      info={crd('PolicyAutomation')}
      columns={[
        col<PolicyAutomationJson>(
          'policy',
          t('Policy'),
          j => j.spec?.policyRef,
          j =>
            j.spec?.policyRef ? (
              <ResourceRefLink
                kind="Policy"
                name={j.spec.policyRef}
                namespace={j.metadata.namespace}
              />
            ) : (
              '-'
            )
        ),
        col<PolicyAutomationJson>('mode', t('Mode'), j => j.spec?.mode),
        col<PolicyAutomationJson>(
          'template',
          t('Ansible template'),
          j => j.spec?.automationDef?.name
        ),
      ]}
    />
  );
}

export function PolicyAutomationDetail() {
  const { t } = useText();
  return (
    <OcmDetailView
      info={crd('PolicyAutomation')}
      conditions={false}
      extraInfo={item => {
        const j = item.jsonData as PolicyAutomationJson;
        const d = j.spec?.automationDef;
        return [
          {
            name: t('Policy'),
            value: j.spec?.policyRef ? (
              <ResourceRefLink
                kind="Policy"
                name={j.spec.policyRef}
                namespace={j.metadata.namespace}
              />
            ) : (
              '-'
            ),
          },
          { name: t('Mode'), value: j.spec?.mode || '-' },
          { name: t('Runs on'), value: j.spec?.eventHook || 'noncompliant' },
          {
            name: t('Delay after run'),
            value:
              j.spec?.delayAfterRunSeconds !== undefined
                ? t('{{s}} s', { s: j.spec.delayAfterRunSeconds })
                : '-',
          },
          { name: t('Ansible job template'), value: d?.name || '-' },
          {
            name: t('Credential secret'),
            value: d?.secret ? (
              <ResourceRefLink kind="Secret" name={d.secret} namespace={j.metadata.namespace} />
            ) : (
              '-'
            ),
          },
          {
            name: t('Clusters with events'),
            value: <StringArray items={Object.keys(j.status?.clustersWithEvent || {})} />,
          },
        ];
      }}
    />
  );
}

// ----- ConfigurationPolicy / OperatorPolicy (evaluated on this cluster) -----

interface EvaluatedPolicyJson extends KubeJson {
  spec?: {
    remediationAction?: string;
    severity?: string;
    subscription?: { name?: string; channel?: string };
  };
  status?: {
    compliant?: string;
    lastEvaluated?: string;
    relatedObjects?: Array<{
      compliant?: string;
      reason?: string;
      object?: { kind?: string; metadata?: { name?: string; namespace?: string } };
    }>;
    history?: Array<{ lastTimestamp?: string; message?: string }>;
    conditions?: Array<{ type: string; status: string; message?: string; reason?: string }>;
  };
}

function evaluatedColumns(t: (s: string) => string) {
  return [
    col<EvaluatedPolicyJson>(
      'compliance',
      t('Compliance'),
      j => j.status?.compliant,
      j => <ComplianceLabel value={j.status?.compliant} />
    ),
    col<EvaluatedPolicyJson>('remediation', t('Remediation'), j => j.spec?.remediationAction),
    col<EvaluatedPolicyJson>('severity', t('Severity'), j => j.spec?.severity),
    col<EvaluatedPolicyJson>(
      'root',
      t('From policy'),
      j => j.metadata.ownerReferences?.find(o => o.kind === 'Policy')?.name
    ),
  ];
}

type Related = NonNullable<NonNullable<EvaluatedPolicyJson['status']>['relatedObjects']>[number];
type History = NonNullable<NonNullable<EvaluatedPolicyJson['status']>['history']>[number];

function evaluatedDetail(kind: 'ConfigurationPolicy' | 'OperatorPolicy') {
  return function EvaluatedDetail() {
    const { t } = useText();
    return (
      <OcmDetailView
        info={crd(kind)}
        conditions={kind === 'OperatorPolicy'}
        extraInfo={item => {
          const j = item.jsonData as EvaluatedPolicyJson;
          const owner = j.metadata.ownerReferences?.find(o => o.kind === 'Policy')?.name;
          return [
            { name: t('Compliance'), value: <ComplianceLabel value={j.status?.compliant} /> },
            { name: t('Remediation'), value: j.spec?.remediationAction || '-' },
            { name: t('Severity'), value: j.spec?.severity || '-' },
            {
              name: t('Operator'),
              value: j.spec?.subscription?.name,
              hide: kind !== 'OperatorPolicy',
            },
            {
              name: t('From policy'),
              value: owner ? (
                <ResourceRefLink kind="Policy" name={owner} namespace={j.metadata.namespace} />
              ) : (
                '-'
              ),
            },
            {
              name: t('Last evaluated'),
              value: j.status?.lastEvaluated ? <DateLabel date={j.status.lastEvaluated} /> : '-',
            },
          ];
        }}
        sections={item => {
          const j = item.jsonData as EvaluatedPolicyJson;
          return [
            {
              id: 'mch-related',
              section: (
                <RelatedTable
                  title={t('Related objects')}
                  items={j.status?.relatedObjects || []}
                  what={t('objects')}
                  emptyMessage={t('No related objects.')}
                  columns={[
                    { label: t('Kind'), getter: (r: Related) => r.object?.kind || '-' },
                    {
                      label: t('Name'),
                      getter: (r: Related) =>
                        `${r.object?.metadata?.namespace ? `${r.object.metadata.namespace}/` : ''}${
                          r.object?.metadata?.name || '?'
                        }`,
                    },
                    {
                      label: t('Compliance'),
                      getter: (r: Related) => <ComplianceLabel value={r.compliant} />,
                    },
                    { label: t('Reason'), getter: (r: Related) => r.reason || '-' },
                  ]}
                />
              ),
            },
            {
              id: 'mch-history',
              section: (
                <RelatedTable
                  title={t('History')}
                  items={j.status?.history || []}
                  what={t('history')}
                  emptyMessage={t('No history.')}
                  columns={[
                    {
                      label: t('Time'),
                      getter: (h: History) =>
                        h.lastTimestamp ? <DateLabel date={h.lastTimestamp} /> : '-',
                    },
                    {
                      label: t('Message'),
                      getter: (h: History) => (
                        <Typography variant="body2" sx={{ wordBreak: 'break-word' }}>
                          {h.message || '-'}
                        </Typography>
                      ),
                    },
                  ]}
                />
              ),
            },
          ];
        }}
      />
    );
  };
}

export function ConfigurationPolicyList() {
  const { t } = useText();
  return <OcmListView info={crd('ConfigurationPolicy')} columns={evaluatedColumns(t)} />;
}

export function OperatorPolicyList() {
  const { t } = useText();
  return (
    <OcmListView
      info={crd('OperatorPolicy')}
      columns={[
        ...evaluatedColumns(t),
        col<EvaluatedPolicyJson>('operator', t('Operator'), j => j.spec?.subscription?.name),
      ]}
    />
  );
}

export const ConfigurationPolicyDetail = evaluatedDetail('ConfigurationPolicy');
export const OperatorPolicyDetail = evaluatedDetail('OperatorPolicy');
