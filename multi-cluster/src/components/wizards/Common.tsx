/**
 * Building blocks shared by the wizards: API versions in use, bound sets of a namespace and the
 * "use an existing placement or create one" step.
 */
import { Box, FormControlLabel, Radio, RadioGroup } from '@mui/material';
import React from 'react';
import { chosenApiVersion } from '../../api/discovery';
import { FormSection, SelectInput, SwitchInput, TextInput } from '../../common/form/Fields';
import { ValidationError } from '../../common/form/types';
import { useText } from '../../common/i18n';
import { setIn } from '../../common/objects';
import { isValidResourceName } from '../../common/objects';
import { useAvailability } from '../../hooks/useDiscovery';
import { useOcmList } from '../../hooks/useOcmList';
import { boundSets, ManagedClusterSetBindingJson } from '../../resources/models/cluster';
import { PlacementJson } from '../../resources/models/placement';
import { crd } from '../../resources/registry';
import { validatePlacementSpec } from '../../utils/validation';
import { PlacementChoice } from '../../utils/wizards';
import {
  ClusterSetsSection,
  PredicatesSection,
  SelectionLimitsSection,
  TolerationsSection,
} from '../placements/Forms';
import { PlacementPreviewPanel } from '../placements/Preview';

/** apiVersion in use for a kind, falling back to the first supported version. */
export function useApiVersion(kind: string): string {
  const availability = useAvailability();
  const info = crd(kind);
  return chosenApiVersion(availability, info) || `${info.group}/${info.versions[0]}`;
}

/** Cluster sets bound to a namespace ([] while loading or without a namespace). */
export function useBoundSets(namespace: string | undefined): string[] {
  const bindings = useOcmList<ManagedClusterSetBindingJson>('ManagedClusterSetBinding', {
    namespace,
    enabled: !!namespace,
  });
  return React.useMemo(
    () => (namespace && bindings.items ? boundSets(bindings.items, namespace) : []),
    [bindings.items, namespace]
  );
}

export function placementChoiceErrors(choice: PlacementChoice): ValidationError[] {
  if (!choice.name) return [{ key: 'Choose or name a placement' }];
  if (choice.mode === 'new' && !isValidResourceName(choice.name)) {
    return [{ key: 'The placement name must be a lowercase RFC 1123 name' }];
  }
  return choice.mode === 'new' ? validatePlacementSpec(choice.spec) : [];
}

/** Step content: pick an existing placement of the namespace, or define a new one. */
export function PlacementChoiceStep({
  namespace,
  value,
  onChange,
  showPreview = true,
}: {
  namespace: string;
  value: PlacementChoice;
  onChange: (next: PlacementChoice) => void;
  showPreview?: boolean;
}) {
  const { t } = useText();
  const placements = useOcmList<PlacementJson>('Placement', { namespace, enabled: !!namespace });
  const existing = (placements.items || []).map(p => p.metadata.name).sort();
  const setSpec = (path: string[], v: unknown) =>
    onChange({ ...value, spec: setIn(value.spec, path, v) });
  const bound = useBoundSets(namespace);
  const unbound = (value.spec.clusterSets || []).filter(s => !bound.includes(s));
  return (
    <Box>
      <RadioGroup
        row
        value={value.mode}
        onChange={e =>
          onChange({ ...value, mode: e.target.value as PlacementChoice['mode'], name: '' })
        }
        sx={{ mb: 2 }}
      >
        <FormControlLabel value="new" control={<Radio />} label={t('Create a new placement')} />
        <FormControlLabel
          value="existing"
          control={<Radio />}
          label={t('Use an existing placement')}
          disabled={existing.length === 0}
        />
      </RadioGroup>
      {value.mode === 'existing' ? (
        <FormSection title={t('Placement')} icon="mdi:target">
          <SelectInput
            label={t('Placement in {{ns}}', { ns: namespace })}
            value={value.name || undefined}
            onChange={name => onChange({ ...value, name: name || '' })}
            options={existing}
            allowEmpty={false}
            required
          />
        </FormSection>
      ) : (
        <>
          <FormSection title={t('New placement')} icon="mdi:target">
            <TextInput
              label={t('Placement name')}
              value={value.name}
              onChange={name => onChange({ ...value, name: name || '' })}
              required
            />
          </FormSection>
          <ClusterSetsSection
            namespace={namespace}
            value={value.spec.clusterSets}
            onChange={v => setSpec(['clusterSets'], v)}
          />
          {unbound.length > 0 && (
            <Box sx={{ mt: -1, mb: 2 }}>
              <SwitchInput
                label={t('Create the missing cluster set bindings in {{ns}}', { ns: namespace })}
                value={value.createBindings}
                onChange={v => onChange({ ...value, createBindings: !!v })}
              />
            </Box>
          )}
          <PredicatesSection
            value={value.spec.predicates}
            onChange={v => setSpec(['predicates'], v)}
          />
          <SelectionLimitsSection
            value={value.spec}
            onChange={spec => onChange({ ...value, spec })}
          />
          <TolerationsSection
            value={value.spec.tolerations}
            onChange={v => setSpec(['tolerations'], v)}
          />
          {showPreview && (
            <FormSection title={t('Matching clusters')} icon="mdi:eye-outline">
              <PlacementPreviewPanel
                spec={value.spec}
                namespace={namespace}
                // Bindings created by the wizard count as bound for the preview.
                extraBoundSets={value.createBindings ? unbound : []}
              />
            </FormSection>
          )}
        </>
      )}
    </Box>
  );
}
