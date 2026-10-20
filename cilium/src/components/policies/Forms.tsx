import { Alert, Box, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import React from 'react';
import { CodeBlock } from '../../common/CodeBlock';
import { ArrayEditor, FieldGrid, FormSection, TextInput } from '../../common/form/Fields';
import { ResourceFormProps } from '../../common/form/ResourceEditor';
import { ValidationError } from '../../common/form/types';
import { SummaryList, Wizard } from '../../common/form/Wizard';
import { useText } from '../../common/i18n';
import { setIn } from '../../common/objects';
import { dumpYaml } from '../../common/yaml';
import { Direction, EgressRule, IngressRule, PolicyRule } from '../../resources/networkPolicy';
import { KubeJson, LabelSelector } from '../../resources/types';
import { validatePolicyRule } from '../../utils/validation';
import { MetadataFields } from '../common/form/SelectorEditor';
import { PolicyVisualization } from './PolicyVisualization';
import { DirectionRules, PolicyRuleEditor, withField } from './RuleEditor';
import { WorkloadTarget } from './WorkloadTarget';

type AnyRule = IngressRule & EgressRule;

function isClusterwide(value: KubeJson): boolean {
  return value.kind === 'CiliumClusterwideNetworkPolicy';
}

const EMPTY_RULE: PolicyRule = { endpointSelector: { matchLabels: {} } };

/** Full form for CiliumNetworkPolicy and CiliumClusterwideNetworkPolicy. */
export function NetworkPolicyForm({ value, onChange, mode }: ResourceFormProps) {
  const { t } = useText();
  const clusterwide = isClusterwide(value);
  const namespace = clusterwide ? undefined : value.metadata?.namespace;
  const specs: PolicyRule[] | undefined = Array.isArray(value.specs) ? value.specs : undefined;

  return (
    <>
      <FormSection title={t('General')} icon="mdi:tag-outline">
        <MetadataFields value={value} onChange={onChange} mode={mode} />
      </FormSection>
      {value.spec || !specs ? (
        <PolicyRuleEditor
          rule={value.spec || EMPTY_RULE}
          onChange={rule => onChange({ ...value, spec: rule })}
          clusterwide={clusterwide}
          namespace={namespace}
        />
      ) : null}
      {specs && (
        <FormSection
          title={t('Rule sets')}
          description={t(
            'This policy uses "specs": a list of independent rule sets, each with its own selector.'
          )}
          icon="mdi:format-list-numbered"
        >
          <ArrayEditor<PolicyRule>
            items={specs}
            onChange={next => onChange(setIn(value, ['specs'], next))}
            newItem={() => ({ endpointSelector: { matchLabels: {} } })}
            addLabel={t('Add rule set')}
            itemTitle={(rule, i) => rule.description || t('Rule set #{{index}}', { index: i + 1 })}
            minItems={1}
            renderItem={(rule, update) => (
              <PolicyRuleEditor
                rule={rule}
                onChange={update}
                clusterwide={clusterwide}
                namespace={namespace}
              />
            )}
          />
        </FormSection>
      )}
    </>
  );
}

type DirectionMode = 'unrestricted' | 'denyAll' | 'custom';

function isEmptyRule(rule: AnyRule): boolean {
  return Object.keys(rule).length === 0;
}

function initialMode(allow?: AnyRule[], deny?: AnyRule[]): DirectionMode {
  if (!allow?.length && !deny?.length) return 'unrestricted';
  if (allow?.length === 1 && isEmptyRule(allow[0]) && !deny?.length) return 'denyAll';
  return 'custom';
}

/** Wizard step for one traffic direction: leave open, deny everything or allow selected peers. */
function DirectionStep({
  direction,
  rule,
  onChange,
  namespace,
  namespaced,
}: {
  direction: Direction;
  rule: PolicyRule;
  onChange: (next: PolicyRule) => void;
  namespace?: string;
  namespaced: boolean;
}) {
  const { t } = useText();
  const allowKey = direction;
  const denyKey = direction === 'ingress' ? 'ingressDeny' : 'egressDeny';
  const allow = rule[allowKey] as AnyRule[] | undefined;
  const denyRules = rule[denyKey] as AnyRule[] | undefined;
  const [mode, setMode] = React.useState<DirectionMode>(() => initialMode(allow, denyRules));

  const selectMode = (next: DirectionMode | null) => {
    if (!next || next === mode) return;
    setMode(next);
    if (next === 'unrestricted') {
      onChange(withField(withField(rule, allowKey, undefined), denyKey, undefined));
    } else if (next === 'denyAll') {
      onChange(withField(withField(rule, allowKey, [{}]), denyKey, undefined));
    } else if (!allow?.length || (allow.length === 1 && isEmptyRule(allow[0]))) {
      // Start from an empty list; the presets and "add rule" fill it.
      onChange(withField(rule, allowKey, [{}]));
    }
  };
  const ingress = direction === 'ingress';

  return (
    <Box>
      <ToggleButtonGroup
        exclusive
        size="small"
        value={mode}
        onChange={(_, v) => selectMode(v)}
        aria-label={ingress ? t('Ingress mode') : t('Egress mode')}
        sx={{ mb: 2 }}
      >
        <ToggleButton value="unrestricted">{t('Do not restrict')}</ToggleButton>
        <ToggleButton value="denyAll">{t('Deny all')}</ToggleButton>
        <ToggleButton value="custom">{t('Allow selected traffic')}</ToggleButton>
      </ToggleButtonGroup>
      {mode === 'unrestricted' && (
        <Typography variant="body2" color="text.secondary">
          {ingress
            ? t('This policy will not affect incoming traffic of the selected endpoints.')
            : t('This policy will not affect outgoing traffic of the selected endpoints.')}
        </Typography>
      )}
      {mode === 'denyAll' && (
        <Alert severity="warning">
          {ingress
            ? t(
                'All incoming traffic to the selected endpoints is denied, unless another policy allows it.'
              )
            : t(
                'All outgoing traffic from the selected endpoints is denied, including DNS, unless another policy allows it.'
              )}
        </Alert>
      )}
      {mode === 'custom' && (
        <>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            {ingress
              ? t(
                  'Only the traffic described by these rules can reach the selected endpoints. A rule combines who (endpoints, entities, CIDRs) with which ports and optional L7 rules.'
                )
              : t(
                  'The selected endpoints can only send the traffic described by these rules. Add the DNS rule if they need name resolution; it is required for FQDN rules.'
                )}
          </Typography>
          <DirectionRules
            rules={allow}
            onChange={next => onChange(withField(rule, allowKey, next?.length ? next : [{}]))}
            direction={direction}
            deny={false}
            namespace={namespace}
            namespaced={namespaced}
          />
          <Typography variant="subtitle2" sx={{ mt: 3, mb: 1 }}>
            {t('Deny rules (optional)')}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            {t(
              'Deny rules take precedence over every allow rule, including those of other policies.'
            )}
          </Typography>
          <DirectionRules
            rules={denyRules}
            onChange={next => onChange(withField(rule, denyKey, next))}
            direction={direction}
            deny
            namespace={namespace}
            namespaced={namespaced}
          />
        </>
      )}
    </Box>
  );
}

/** Errors of the policy rule that belong to a wizard step. */
function stepErrors(errors: ValidationError[], match: RegExp): ValidationError[] {
  return errors.filter(e => match.test(String(e.params?.where ?? e.key)));
}

/**
 * Step-by-step creation of a network policy: target endpoints, ingress, egress, review. All
 * steps edit `spec` of the same object, so the YAML tab always shows the full result.
 */
export function NetworkPolicyWizard({
  value,
  onChange,
  mode,
  errors,
  onSubmit,
  submitting,
}: ResourceFormProps) {
  const { t } = useText();
  const clusterwide = isClusterwide(value);
  const namespace = clusterwide ? undefined : value.metadata?.namespace;
  const rule: PolicyRule = value.spec || EMPTY_RULE;
  const setRule = (next: PolicyRule) => onChange({ ...value, spec: next });
  const selector: LabelSelector = rule.endpointSelector || { matchLabels: {} };
  const ruleErrors = validatePolicyRule(rule, clusterwide);
  const metadataErrors = errors.filter(e => /name|namespace/i.test(e.key) && !e.params?.where);

  return (
    <Wizard
      onSubmit={onSubmit}
      submitting={submitting}
      submitLabel={mode === 'create' ? t('Create policy') : t('Apply')}
      allErrors={errors}
      steps={[
        {
          id: 'target',
          label: t('Target'),
          description: clusterwide
            ? t('Name the policy and choose the workload it protects, in any namespace.')
            : t('Name the policy and choose the workload it protects.'),
          errors: [...metadataErrors, ...stepErrors(ruleErrors, /selector|Select/)],
          content: (
            <>
              <MetadataFields value={value} onChange={onChange} mode={mode} />
              <Box sx={{ mt: 2 }}>
                <FieldGrid columns={1}>
                  <TextInput
                    label={t('Description')}
                    value={rule.description}
                    onChange={v => setRule(withField(rule, 'description', v))}
                  />
                </FieldGrid>
              </Box>
              <Box sx={{ mt: 3 }}>
                <WorkloadTarget
                  selector={selector}
                  onChange={next => setRule({ ...rule, endpointSelector: next })}
                  namespace={namespace}
                  clusterwide={clusterwide}
                />
              </Box>
            </>
          ),
        },
        {
          id: 'ingress',
          label: t('Ingress'),
          description: t('Which traffic may reach the selected endpoints?'),
          errors: stepErrors(ruleErrors, /^ingress/),
          optional: true,
          content: (
            <DirectionStep
              direction="ingress"
              rule={rule}
              onChange={setRule}
              namespace={namespace}
              namespaced={!clusterwide}
            />
          ),
        },
        {
          id: 'egress',
          label: t('Egress'),
          description: t('Which traffic may the selected endpoints send?'),
          errors: stepErrors(ruleErrors, /^egress/),
          optional: true,
          content: (
            <DirectionStep
              direction="egress"
              rule={rule}
              onChange={setRule}
              namespace={namespace}
              namespaced={!clusterwide}
            />
          ),
        },
        {
          id: 'review',
          label: t('Review'),
          description: t('Check the resulting policy before it is applied.'),
          content: (
            <>
              <SummaryList
                rows={[
                  { label: t('Kind'), value: value.kind },
                  {
                    label: t('Name'),
                    value: `${namespace ? `${namespace}/` : ''}${value.metadata?.name || '-'}`,
                  },
                ]}
              />
              <Typography variant="subtitle2" sx={{ mt: 3, mb: 1 }}>
                {t('Allowed traffic')}
              </Typography>
              <PolicyVisualization rules={[rule]} namespace={namespace} />
              {!rule.ingress?.length &&
                !rule.egress?.length &&
                !rule.ingressDeny?.length &&
                !rule.egressDeny?.length && (
                  <Alert severity="warning" sx={{ mt: 2 }}>
                    {t(
                      'The policy has no ingress or egress rules, so it does not change anything.'
                    )}
                  </Alert>
                )}
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
