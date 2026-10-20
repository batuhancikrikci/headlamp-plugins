/**
 * Create a Placement: namespace and name, cluster sets (with binding check), label / claim
 * predicates, prioritizers, tolerations and a preview of the matching clusters.
 */
import { Alert, Box } from '@mui/material';
import React from 'react';
import {
  ComboInput,
  FieldGrid,
  FormSection,
  SwitchInput,
  TextInput,
} from '../../common/form/Fields';
import { SetupWizardDialog } from '../../common/form/SetupWizardDialog';
import { ValidationError } from '../../common/form/types';
import { useText } from '../../common/i18n';
import { isValidDNSLabel, isValidResourceName, setIn } from '../../common/objects';
import { useNamespaceNames } from '../../hooks/useOcmList';
import { PlacementSpec } from '../../resources/models/placement';
import { validatePlacementSpec } from '../../utils/validation';
import { placementResources } from '../../utils/wizards';
import {
  ClusterSetsSection,
  PredicatesSection,
  PrioritizersSection,
  SelectionLimitsSection,
  SpreadSection,
  TolerationsSection,
} from '../placements/Forms';
import { PlacementPreviewPanel } from '../placements/Preview';
import { useApiVersion, useBoundSets } from './Common';

export function PlacementWizard({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useText();
  const namespaces = useNamespaceNames();
  const placementVersion = useApiVersion('Placement');
  const bindingVersion = useApiVersion('ManagedClusterSetBinding');
  const [namespace, setNamespace] = React.useState('');
  const [name, setName] = React.useState('');
  const [spec, setSpec] = React.useState<PlacementSpec>({ clusterSets: [] });
  const [createBindings, setCreateBindings] = React.useState(true);
  const bound = useBoundSets(namespace);
  const unbound = (spec.clusterSets || []).filter(s => !bound.includes(s));
  const set = (path: string[], v: unknown) => setSpec(s => setIn(s, path, v));

  const basicErrors: ValidationError[] = [];
  if (!isValidDNSLabel(namespace)) basicErrors.push({ key: 'Choose a namespace' });
  if (!isValidResourceName(name)) basicErrors.push({ key: 'Enter a valid placement name' });
  const setErrors: ValidationError[] =
    !createBindings && unbound.length > 0
      ? [
          {
            key: 'Bind {{sets}} to {{ns}} or enable the binding creation',
            params: { sets: unbound.join(', '), ns: namespace },
          },
        ]
      : [];

  const resources = React.useMemo(
    () =>
      placementResources({ mode: 'new', name, spec, createBindings }, namespace, bound, {
        placement: placementVersion,
        binding: bindingVersion,
      }),
    [name, spec, createBindings, namespace, bound, placementVersion, bindingVersion]
  );

  return (
    <SetupWizardDialog
      open={open}
      onClose={onClose}
      title={t('Create a placement')}
      resources={resources}
      steps={[
        {
          id: 'basics',
          label: t('Basics'),
          description: t(
            'Placements live in a namespace; workloads, subscriptions and GitOps clusters in the same namespace can use them.'
          ),
          errors: basicErrors,
          content: (
            <FormSection
              title={t('Placement')}
              icon="mdi:target"
              docsUrl="https://open-cluster-management.io/docs/concepts/content-placement/placement/"
            >
              <FieldGrid columns={2}>
                <ComboInput
                  label={t('Namespace')}
                  value={namespace}
                  onChange={v => setNamespace(v || '')}
                  options={namespaces}
                  required
                />
                <TextInput
                  label={t('Name')}
                  value={name}
                  onChange={v => setName(v || '')}
                  required
                />
              </FieldGrid>
            </FormSection>
          ),
        },
        {
          id: 'sets',
          label: t('Cluster sets'),
          errors: setErrors,
          content: (
            <Box>
              <ClusterSetsSection
                namespace={namespace}
                value={spec.clusterSets}
                onChange={v => set(['clusterSets'], v)}
              />
              {unbound.length > 0 && (
                <SwitchInput
                  label={t('Create ManagedClusterSetBindings for {{sets}} in {{ns}}', {
                    sets: unbound.join(', '),
                    ns: namespace,
                  })}
                  value={createBindings}
                  onChange={v => setCreateBindings(!!v)}
                  helperText={t('Requires create on managedclustersets/bind for each set.')}
                />
              )}
            </Box>
          ),
        },
        {
          id: 'selectors',
          label: t('Selectors'),
          errors: validatePlacementSpec({ predicates: spec.predicates }),
          content: (
            <PredicatesSection value={spec.predicates} onChange={v => set(['predicates'], v)} />
          ),
        },
        {
          id: 'scheduling',
          label: t('Scheduling'),
          optional: true,
          errors: validatePlacementSpec({ ...spec, predicates: undefined }),
          content: (
            <Box>
              <SelectionLimitsSection value={spec} onChange={setSpec} />
              <PrioritizersSection value={spec} onChange={setSpec} />
              <TolerationsSection
                value={spec.tolerations}
                onChange={v => set(['tolerations'], v)}
              />
              <SpreadSection
                value={spec.spreadPolicy?.spreadConstraints}
                onChange={v => set(['spreadPolicy', 'spreadConstraints'], v)}
              />
            </Box>
          ),
        },
        {
          id: 'preview',
          label: t('Preview'),
          description: t(
            'Clusters the placement would select, evaluated in the browser from the clusters you can see.'
          ),
          content: namespace ? (
            <PlacementPreviewPanel
              spec={spec}
              namespace={namespace}
              extraBoundSets={createBindings ? unbound : []}
            />
          ) : (
            <Alert severity="info">{t('Choose a namespace first.')}</Alert>
          ),
        },
      ]}
    />
  );
}
