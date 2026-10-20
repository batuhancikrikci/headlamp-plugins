/**
 * Deploy an application: Channel (Git / Helm / object bucket, new or existing) → Subscription →
 * Placement (new or existing), ending with the review and YAML preview.
 */
import { Box, FormControlLabel, Radio, RadioGroup } from '@mui/material';
import React from 'react';
import {
  ComboInput,
  FieldGrid,
  FormSection,
  SelectInput,
  TextInput,
} from '../../common/form/Fields';
import { SetupWizardDialog } from '../../common/form/SetupWizardDialog';
import { ValidationError } from '../../common/form/types';
import { SummaryList } from '../../common/form/Wizard';
import { useText } from '../../common/i18n';
import { isValidDNSLabel, isValidResourceName, setIn } from '../../common/objects';
import { useNamespaceNames, useOcmList } from '../../hooks/useOcmList';
import { ChannelJson, channelType, parseChannelRef } from '../../resources/models/apps';
import { KubeJson } from '../../resources/models/common';
import { validateResource } from '../../utils/validation';
import { emptyPlacementChoice, PlacementChoice, placementResources } from '../../utils/wizards';
import { ChannelSpecSection, SubscriptionContentSection } from '../applications/Forms';
import { placementChoiceErrors, PlacementChoiceStep, useApiVersion, useBoundSets } from './Common';

export function DeployAppWizard({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useText();
  const namespaces = useNamespaceNames();
  const channelVersion = useApiVersion('Channel');
  const subVersion = useApiVersion('Subscription');
  const placementVersion = useApiVersion('Placement');
  const bindingVersion = useApiVersion('ManagedClusterSetBinding');
  const channels = useOcmList<ChannelJson>('Channel');

  const [channelMode, setChannelMode] = React.useState<'new' | 'existing'>('new');
  const [existingChannel, setExistingChannel] = React.useState<string>();
  const [channel, setChannel] = React.useState<KubeJson>({
    apiVersion: channelVersion,
    kind: 'Channel',
    metadata: { name: '', namespace: '' },
    spec: { type: 'Git', pathname: '' },
  });
  const [sub, setSub] = React.useState<KubeJson>({
    apiVersion: subVersion,
    kind: 'Subscription',
    metadata: { name: '', namespace: '' },
    spec: { channel: '' },
  });
  const [placement, setPlacement] = React.useState<PlacementChoice>(emptyPlacementChoice());
  const subNs = sub.metadata.namespace || '';
  const bound = useBoundSets(subNs);

  const channelRef =
    channelMode === 'existing'
      ? existingChannel || ''
      : `${channel.metadata.namespace}/${channel.metadata.name}`;
  const selectedChannel =
    channelMode === 'existing'
      ? (channels.items || []).find(
          c => `${c.metadata.namespace}/${c.metadata.name}` === existingChannel
        )
      : (channel as ChannelJson);
  const type = selectedChannel ? channelType(selectedChannel) : undefined;

  const resources = React.useMemo(() => {
    const out: KubeJson[] = [];
    if (channelMode === 'new') out.push({ ...channel, apiVersion: channelVersion });
    out.push(
      ...placementResources(placement, subNs, bound, {
        placement: placementVersion,
        binding: bindingVersion,
      })
    );
    let subscription: KubeJson = setIn(
      { ...sub, apiVersion: subVersion },
      ['spec', 'channel'],
      channelRef
    );
    if (placement.name) {
      subscription = setIn(subscription, ['spec', 'placement', 'placementRef'], {
        kind: 'Placement',
        apiVersion: placementVersion,
        name: placement.name,
      });
    }
    out.push(subscription);
    return out;
  }, [
    channelMode,
    channel,
    channelVersion,
    placement,
    subNs,
    bound,
    placementVersion,
    bindingVersion,
    sub,
    subVersion,
    channelRef,
  ]);

  const channelErrors: ValidationError[] =
    channelMode === 'existing'
      ? parseChannelRef(existingChannel)
        ? []
        : [{ key: 'Choose a channel' }]
      : validateResource(channel);
  const subErrors: ValidationError[] = [];
  if (!isValidDNSLabel(subNs)) subErrors.push({ key: 'Choose the subscription namespace' });
  if (!isValidResourceName(sub.metadata.name))
    subErrors.push({ key: 'Enter a valid subscription name' });
  if (type === 'HelmRepo' && !sub.spec?.name) subErrors.push({ key: 'Enter the chart name' });

  return (
    <SetupWizardDialog
      open={open}
      onClose={onClose}
      title={t('Deploy an application')}
      resources={resources}
      summary={
        <SummaryList
          rows={[
            { label: t('Channel'), value: `${channelRef} (${type || '?'})` },
            { label: t('Subscription'), value: `${subNs}/${sub.metadata.name}` },
            {
              label: t('Placement'),
              value: placement.name
                ? `${subNs}/${placement.name} (${
                    placement.mode === 'new' ? t('new') : t('existing')
                  })`
                : '-',
            },
          ]}
        />
      }
      steps={[
        {
          id: 'channel',
          label: t('Channel'),
          description: t(
            'The source of the application: a Git repository, a Helm repository or an object bucket.'
          ),
          errors: channelErrors,
          content: (
            <Box>
              <RadioGroup
                row
                value={channelMode}
                onChange={e => setChannelMode(e.target.value as 'new' | 'existing')}
                sx={{ mb: 2 }}
              >
                <FormControlLabel value="new" control={<Radio />} label={t('Create a channel')} />
                <FormControlLabel
                  value="existing"
                  control={<Radio />}
                  label={t('Use an existing channel')}
                  disabled={(channels.items || []).length === 0}
                />
              </RadioGroup>
              {channelMode === 'existing' ? (
                <FormSection title={t('Channel')} icon="mdi:source-repository">
                  <SelectInput
                    label={t('Channel')}
                    value={existingChannel}
                    onChange={setExistingChannel}
                    options={(channels.items || []).map(c => ({
                      value: `${c.metadata.namespace}/${c.metadata.name}`,
                      description: `${channelType(c)} · ${c.spec?.pathname || ''}`,
                    }))}
                    allowEmpty={false}
                  />
                </FormSection>
              ) : (
                <>
                  <FormSection title={t('New channel')} icon="mdi:source-repository">
                    <FieldGrid columns={2}>
                      <ComboInput
                        label={t('Channel namespace')}
                        value={channel.metadata.namespace}
                        onChange={v =>
                          setChannel(setIn(channel, ['metadata', 'namespace'], v || ''))
                        }
                        options={namespaces}
                        required
                      />
                      <TextInput
                        label={t('Channel name')}
                        value={channel.metadata.name}
                        onChange={v => setChannel(setIn(channel, ['metadata', 'name'], v || ''))}
                        required
                      />
                    </FieldGrid>
                  </FormSection>
                  <ChannelSpecSection value={channel} onChange={setChannel} />
                </>
              )}
            </Box>
          ),
        },
        {
          id: 'subscription',
          label: t('Subscription'),
          description: t(
            'The subscription deploys the channel content to the clusters of its placement.'
          ),
          errors: subErrors,
          content: (
            <Box>
              <FormSection title={t('Subscription')} icon="mdi:apps">
                <FieldGrid columns={2}>
                  <ComboInput
                    label={t('Namespace')}
                    value={subNs}
                    onChange={v => setSub(setIn(sub, ['metadata', 'namespace'], v || ''))}
                    options={namespaces}
                    required
                    help={t(
                      'Also the namespace of the placement and of the deployed resources on the managed clusters (unless they set their own).'
                    )}
                  />
                  <TextInput
                    label={t('Name')}
                    value={sub.metadata.name}
                    onChange={v => setSub(setIn(sub, ['metadata', 'name'], v || ''))}
                    required
                  />
                </FieldGrid>
              </FormSection>
              <SubscriptionContentSection value={sub} onChange={setSub} type={type} />
            </Box>
          ),
        },
        {
          id: 'placement',
          label: t('Placement'),
          description: t('Which managed clusters receive the application.'),
          errors: subNs
            ? placementChoiceErrors(placement)
            : [{ key: 'Choose the subscription namespace first' }],
          content: subNs ? (
            <PlacementChoiceStep namespace={subNs} value={placement} onChange={setPlacement} />
          ) : null,
        },
      ]}
    />
  );
}
