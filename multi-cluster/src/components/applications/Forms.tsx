/**
 * Subscription and Channel forms. The sections are reused by the deploy-application wizard.
 */
import { Box } from '@mui/material';
import React from 'react';
import { chosenApiVersion } from '../../api/discovery';
import {
  ComboInput,
  FieldGrid,
  FormSection,
  SelectInput,
  StringListInput,
  SwitchInput,
  TextInput,
  useBinder,
} from '../../common/form/Fields';
import { ResourceFormProps } from '../../common/form/ResourceEditor';
import { useText } from '../../common/i18n';
import { getIn, setIn } from '../../common/objects';
import { useAvailability } from '../../hooks/useDiscovery';
import { useCoreList, useOcmList } from '../../hooks/useOcmList';
import {
  BUCKET_PATH_ANNOTATION,
  ChannelJson,
  channelType,
  GIT_ANNOTATIONS,
  SubscriptionJson,
} from '../../resources/models/apps';
import { KubeJson } from '../../resources/models/common';
import { PlacementJson, PlacementRuleJson } from '../../resources/models/placement';
import { crd } from '../../resources/registry';
import { MetadataFields } from '../common/form/MetadataFields';

const DOCS = 'https://open-cluster-management.io/docs/getting-started/integration/app-lifecycle/';

/** Type, URL, credentials and TLS of a channel. */
export function ChannelSpecSection({
  value,
  onChange,
}: {
  value: KubeJson;
  onChange: (next: KubeJson) => void;
}) {
  const { t } = useText();
  const bind = useBinder(value, onChange);
  const secrets = useCoreList('Secret', value.metadata?.namespace || undefined);
  const type = channelType(value as ChannelJson);
  const placeholder =
    type === 'HelmRepo'
      ? 'https://charts.example.com'
      : type === 'ObjectBucket'
      ? 'https://s3.amazonaws.com/my-bucket'
      : type === 'Namespace'
      ? 'my-namespace'
      : 'https://github.com/org/repo.git';
  return (
    <FormSection
      title={t('Source')}
      icon="mdi:source-repository"
      description={t('Where the application content comes from.')}
      docsUrl={DOCS}
    >
      <FieldGrid columns={2}>
        <SelectInput
          {...bind<string>(['spec', 'type'])}
          label={t('Channel type')}
          options={[
            {
              value: 'Git',
              description: t('Kubernetes YAML, Kustomize or Helm charts in a Git repository'),
            },
            { value: 'HelmRepo', description: t('A Helm chart repository') },
            { value: 'ObjectBucket', description: t('Kubernetes YAML in an S3-compatible bucket') },
            { value: 'Namespace', description: t('Resources stored in a hub namespace (legacy)') },
          ]}
          allowEmpty={false}
          required
        />
        <TextInput
          {...bind<string>(['spec', 'pathname'])}
          label={type === 'Namespace' ? t('Namespace') : t('URL')}
          placeholder={placeholder}
          required
        />
        <ComboInput
          value={getIn<string>(value, ['spec', 'secretRef', 'name'])}
          onChange={v => onChange(setIn(value, ['spec', 'secretRef'], v ? { name: v } : undefined))}
          label={t('Credentials secret (optional)')}
          options={(secrets.items || []).map(s => s.metadata.name)}
          help={t(
            'A secret in the channel namespace with user + accessToken or sshKey (Git), user + password (Helm) or AccessKeyID + SecretAccessKey (object bucket).'
          )}
        />
        <SwitchInput
          {...bind<boolean>(['spec', 'insecureSkipVerify'])}
          label={t('Skip TLS verification')}
        />
        <SelectInput
          value={value.metadata?.annotations?.[GIT_ANNOTATIONS.reconcileRate]}
          onChange={v =>
            onChange(setIn(value, ['metadata', 'annotations', GIT_ANNOTATIONS.reconcileRate], v))
          }
          label={t('Reconcile rate')}
          options={['low', 'medium', 'high', 'off']}
          emptyLabel={t('Default (medium)')}
          help={t(
            'How often subscriptions re-check the channel and reconcile the deployed resources.'
          )}
        />
      </FieldGrid>
    </FormSection>
  );
}

export function ChannelForm({ value, onChange, mode }: ResourceFormProps) {
  return (
    <Box>
      <MetadataFields value={value} onChange={onChange} mode={mode} />
      <ChannelSpecSection value={value} onChange={onChange} />
    </Box>
  );
}

/** What to take from the channel: Git branch/path, Helm chart/version or bucket path. */
export function SubscriptionContentSection({
  value,
  onChange,
  type,
}: {
  value: KubeJson;
  onChange: (next: KubeJson) => void;
  /** Channel type, when known. */
  type?: string;
}) {
  const { t } = useText();
  const bind = useBinder(value, onChange);
  const annotation = (key: string) => ({
    value: value.metadata?.annotations?.[key],
    onChange: (v: string | undefined) =>
      onChange(setIn(value, ['metadata', 'annotations', key], v)),
  });
  return (
    <FormSection title={t('Content')} icon="mdi:file-tree-outline">
      {(type === undefined || type === 'Git') && (
        <FieldGrid columns={3}>
          <TextInput
            {...annotation(GIT_ANNOTATIONS.branch)}
            label={t('Git branch')}
            placeholder="main"
          />
          <TextInput
            {...annotation(GIT_ANNOTATIONS.path)}
            label={t('Path in the repository')}
            placeholder="deploy/app"
          />
          <TextInput {...annotation(GIT_ANNOTATIONS.tag)} label={t('Git tag (optional)')} />
          <TextInput
            {...annotation(GIT_ANNOTATIONS.desiredCommit)}
            label={t('Pin to commit (optional)')}
          />
          <SelectInput
            {...annotation(GIT_ANNOTATIONS.reconcileOption)}
            label={t('Reconcile option')}
            options={['merge', 'replace', 'mergeAndOwn']}
            help={t('How existing resources on the cluster are updated.')}
          />
          <SelectInput
            {...annotation(GIT_ANNOTATIONS.reconcileRate)}
            label={t('Reconcile rate')}
            options={['off']}
            emptyLabel={t('From the channel')}
            help={t(
              'The rate is set on the channel; a subscription can only turn reconciliation off.'
            )}
          />
        </FieldGrid>
      )}
      {type === 'HelmRepo' && (
        <FieldGrid columns={2}>
          <TextInput {...bind<string>(['spec', 'name'])} label={t('Chart name')} required />
          <TextInput
            {...bind<string>(['spec', 'packageFilter', 'version'])}
            label={t('Chart version (optional)')}
            placeholder=">=1.0.0"
          />
        </FieldGrid>
      )}
      {type === 'ObjectBucket' && (
        <TextInput
          {...annotation(BUCKET_PATH_ANNOTATION)}
          label={t('Folder in the bucket (optional)')}
        />
      )}
    </FormSection>
  );
}

/** Channel reference ("namespace/name") with existing channels as suggestions. */
export function ChannelRefField({
  value,
  onChange,
}: {
  value: KubeJson;
  onChange: (next: KubeJson) => void;
}) {
  const { t } = useText();
  const channels = useOcmList<ChannelJson>('Channel');
  return (
    <ComboInput
      value={value.spec?.channel || undefined}
      onChange={v => onChange(setIn(value, ['spec', 'channel'], v || ''))}
      label={t('Channel (namespace/name)')}
      options={(channels.items || []).map(c => `${c.metadata.namespace}/${c.metadata.name}`).sort()}
      required
    />
  );
}

/** Placement reference of a subscription (Placement preferred, PlacementRule for legacy). */
export function SubscriptionPlacementField({
  value,
  onChange,
}: {
  value: KubeJson;
  onChange: (next: KubeJson) => void;
}) {
  const { t } = useText();
  const availability = useAvailability();
  const ns = value.metadata?.namespace;
  const placements = useOcmList<PlacementJson>('Placement', { namespace: ns, enabled: !!ns });
  const rules = useOcmList<PlacementRuleJson>('PlacementRule', { namespace: ns, enabled: !!ns });
  const ref = value.spec?.placement?.placementRef;
  const kind = ref?.kind || 'Placement';
  const names = (kind === 'Placement' ? placements.items : rules.items) || [];
  const apiVersionOf = (k: string) =>
    k === 'Placement'
      ? chosenApiVersion(availability, crd('Placement'))
      : chosenApiVersion(availability, crd('PlacementRule'));
  return (
    <FieldGrid columns={2}>
      <SelectInput
        label={t('Placement kind')}
        value={kind}
        onChange={k =>
          onChange(
            setIn(value, ['spec', 'placement', 'placementRef'], {
              kind: k || 'Placement',
              apiVersion: apiVersionOf(k || 'Placement'),
              name: '',
            })
          )
        }
        options={[
          { value: 'Placement', description: 'cluster.open-cluster-management.io' },
          ...(rules.missing ? [] : [{ value: 'PlacementRule', description: t('legacy') }]),
        ]}
        allowEmpty={false}
      />
      <SelectInput
        label={t('Placement')}
        value={ref?.name || undefined}
        onChange={name =>
          onChange(
            setIn(
              value,
              ['spec', 'placement', 'placementRef'],
              name ? { kind, apiVersion: apiVersionOf(kind), name } : undefined
            )
          )
        }
        options={names.map(p => p.metadata.name).sort()}
        emptyLabel={t('None')}
        helperText={t('Placements in the subscription namespace.')}
      />
    </FieldGrid>
  );
}

export function SubscriptionForm({ value, onChange, mode }: ResourceFormProps) {
  const { t } = useText();
  const bind = useBinder(value as SubscriptionJson, onChange);
  const channels = useOcmList<ChannelJson>('Channel');
  const ref = (value.spec?.channel || '').split('/');
  const channel = (channels.items || []).find(
    c => c.metadata.namespace === ref[0] && c.metadata.name === ref[1]
  );
  return (
    <Box>
      <MetadataFields value={value} onChange={onChange} mode={mode} />
      <FormSection title={t('Channel')} icon="mdi:source-repository" docsUrl={DOCS}>
        <FieldGrid columns={2}>
          <ChannelRefField value={value} onChange={onChange} />
          <TextInput
            {...bind<string>(['spec', 'secondaryChannel'])}
            label={t('Secondary channel (optional)')}
            placeholder="namespace/name"
          />
        </FieldGrid>
      </FormSection>
      <SubscriptionContentSection
        value={value}
        onChange={onChange}
        type={channel ? channelType(channel) : undefined}
      />
      <FormSection
        title={t('Placement')}
        icon="mdi:target"
        description={t('The clusters the content is deployed to.')}
      >
        <SubscriptionPlacementField value={value} onChange={onChange} />
      </FormSection>
      <FormSection
        title={t('Time window')}
        icon="mdi:calendar-clock"
        description={t(
          'Optional: only deploy (active) or never deploy (blocked) during these times.'
        )}
      >
        <FieldGrid columns={3}>
          <SelectInput
            {...bind<string>(['spec', 'timewindow', 'windowtype'])}
            label={t('Window type')}
            options={['active', 'blocked']}
            emptyLabel={t('No window')}
          />
          <TextInput
            {...bind<string>(['spec', 'timewindow', 'location'])}
            label={t('Time zone')}
            placeholder="America/Toronto"
          />
          <StringListInput
            {...bind<string[]>(['spec', 'timewindow', 'daysofweek'])}
            label={t('Days')}
            suggestions={[
              'Sunday',
              'Monday',
              'Tuesday',
              'Wednesday',
              'Thursday',
              'Friday',
              'Saturday',
            ]}
          />
        </FieldGrid>
      </FormSection>
    </Box>
  );
}
