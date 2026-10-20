/**
 * Distribute a workload: Kubernetes manifests sent either through a ManifestWorkReplicaSet to
 * the clusters of a placement (with a rollout strategy), or as one ManifestWork per chosen
 * cluster.
 */
import { Alert, Box, FormControlLabel, Radio, RadioGroup } from '@mui/material';
import React from 'react';
import { isKindAvailable } from '../../api/discovery';
import {
  ComboInput,
  FieldGrid,
  FormSection,
  StringListInput,
  TextInput,
} from '../../common/form/Fields';
import { SetupWizardDialog } from '../../common/form/SetupWizardDialog';
import { ValidationError } from '../../common/form/types';
import { SummaryList } from '../../common/form/Wizard';
import { useText } from '../../common/i18n';
import { isValidDNSLabel, isValidResourceName } from '../../common/objects';
import { useAvailability } from '../../hooks/useDiscovery';
import { useNamespaceNames, useOcmList } from '../../hooks/useOcmList';
import { ManagedClusterJson } from '../../resources/models/cluster';
import { KubeJson } from '../../resources/models/common';
import { RolloutStrategy } from '../../resources/models/work';
import { crd } from '../../resources/registry';
import { validateResource } from '../../utils/validation';
import {
  emptyPlacementChoice,
  manifestWorksForClusters,
  PlacementChoice,
  placementResources,
} from '../../utils/wizards';
import { StringArray } from '../common/Shared';
import { RolloutEditor, WorkSpecSections } from '../workloads/Forms';
import { placementChoiceErrors, PlacementChoiceStep, useApiVersion, useBoundSets } from './Common';

type Mode = 'placement' | 'clusters';

export function DistributeWorkWizard({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useText();
  const availability = useAvailability();
  const mwrsAvailable = isKindAvailable(availability, crd('ManifestWorkReplicaSet'));
  const namespaces = useNamespaceNames();
  const clusters = useOcmList<ManagedClusterJson>('ManagedCluster');
  const workVersion = useApiVersion('ManifestWork');
  const mwrsVersion = useApiVersion('ManifestWorkReplicaSet');
  const placementVersion = useApiVersion('Placement');
  const bindingVersion = useApiVersion('ManagedClusterSetBinding');

  const [mode, setMode] = React.useState<Mode>(mwrsAvailable ? 'placement' : 'clusters');
  const [name, setName] = React.useState('');
  const [namespace, setNamespace] = React.useState('');
  const [targets, setTargets] = React.useState<string[]>([]);
  const [rollout, setRollout] = React.useState<RolloutStrategy | undefined>({ type: 'All' });
  const [placement, setPlacement] = React.useState<PlacementChoice>(emptyPlacementChoice());
  // Holder object for the shared work spec editor.
  const [holder, setHolder] = React.useState<KubeJson>({
    apiVersion: workVersion,
    kind: 'ManifestWork',
    metadata: { name: 'holder', namespace: 'holder' },
    spec: { workload: { manifests: [] } },
  });
  const bound = useBoundSets(namespace);

  const resources = React.useMemo(() => {
    if (mode === 'clusters')
      return manifestWorksForClusters(name, targets, holder.spec, workVersion);
    const mwrs: KubeJson = {
      apiVersion: mwrsVersion,
      kind: 'ManifestWorkReplicaSet',
      metadata: { name, namespace },
      spec: {
        placementRefs: [{ name: placement.name, ...(rollout ? { rolloutStrategy: rollout } : {}) }],
        manifestWorkTemplate: holder.spec,
      },
    };
    return [
      ...placementResources(placement, namespace, bound, {
        placement: placementVersion,
        binding: bindingVersion,
      }),
      mwrs,
    ];
  }, [
    mode,
    name,
    targets,
    holder.spec,
    workVersion,
    mwrsVersion,
    namespace,
    placement,
    rollout,
    bound,
    placementVersion,
    bindingVersion,
  ]);

  const basicErrors: ValidationError[] = [];
  if (!isValidResourceName(name)) basicErrors.push({ key: 'Enter a valid name' });
  if (mode === 'placement' && !isValidDNSLabel(namespace))
    basicErrors.push({ key: 'Choose the namespace of the replica set' });
  const manifestErrors = validateResource({ ...holder, metadata: { name: 'x', namespace: 'x' } });
  const targetErrors: ValidationError[] =
    mode === 'clusters'
      ? targets.length === 0
        ? [{ key: 'Choose at least one cluster' }]
        : []
      : namespace
      ? placementChoiceErrors(placement)
      : [{ key: 'Choose the namespace first' }];

  return (
    <SetupWizardDialog
      open={open}
      onClose={onClose}
      title={t('Distribute a workload')}
      resources={resources}
      summary={
        <SummaryList
          rows={[
            {
              label: t('Method'),
              value:
                mode === 'placement'
                  ? t('ManifestWorkReplicaSet with a placement')
                  : t('One ManifestWork per cluster'),
            },
            {
              label: t('Targets'),
              value:
                mode === 'placement' ? (
                  `${namespace}/${placement.name}`
                ) : (
                  <StringArray items={targets} />
                ),
            },
            { label: t('Manifests'), value: (holder.spec?.workload?.manifests || []).length },
          ]}
        />
      }
      steps={[
        {
          id: 'method',
          label: t('Method'),
          errors: basicErrors,
          content: (
            <Box>
              <RadioGroup
                value={mode}
                onChange={e => setMode(e.target.value as Mode)}
                sx={{ mb: 2 }}
              >
                <FormControlLabel
                  value="placement"
                  control={<Radio />}
                  disabled={!mwrsAvailable}
                  label={t(
                    'To the clusters of a placement (ManifestWorkReplicaSet, follows placement changes, supports progressive rollout)'
                  )}
                />
                <FormControlLabel
                  value="clusters"
                  control={<Radio />}
                  label={t('To specific clusters (one ManifestWork in each cluster namespace)')}
                />
              </RadioGroup>
              {!mwrsAvailable && (
                <Alert severity="info">
                  {t('ManifestWorkReplicaSet is not installed on this hub.')}
                </Alert>
              )}
              <FormSection title={t('Name')} icon="mdi:package-variant-closed">
                <FieldGrid columns={2}>
                  <TextInput
                    label={t('Name')}
                    value={name}
                    onChange={v => setName(v || '')}
                    required
                  />
                  {mode === 'placement' && (
                    <ComboInput
                      label={t('Namespace')}
                      value={namespace}
                      onChange={v => setNamespace(v || '')}
                      options={namespaces}
                      required
                    />
                  )}
                </FieldGrid>
              </FormSection>
            </Box>
          ),
        },
        {
          id: 'manifests',
          label: t('Manifests'),
          errors: manifestErrors,
          content: <WorkSpecSections value={holder} onChange={setHolder} path={['spec']} />,
        },
        {
          id: 'targets',
          label: t('Targets'),
          errors: targetErrors,
          content:
            mode === 'clusters' ? (
              <FormSection title={t('Clusters')} icon="mdi:server-network">
                <StringListInput
                  label={t('Managed clusters')}
                  value={targets}
                  onChange={v => setTargets(v || [])}
                  suggestions={(clusters.items || []).map(c => c.metadata.name).sort()}
                />
              </FormSection>
            ) : namespace ? (
              <Box>
                <PlacementChoiceStep
                  namespace={namespace}
                  value={placement}
                  onChange={setPlacement}
                />
                <FormSection title={t('Rollout')} icon="mdi:transit-connection-variant">
                  <RolloutEditor value={rollout} onChange={setRollout} />
                </FormSection>
              </Box>
            ) : null,
        },
      ]}
    />
  );
}
