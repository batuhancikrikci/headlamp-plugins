import { Box, Collapse, Link } from '@mui/material';
import React from 'react';
import { isNamespacedKind } from '../../../api/kinds';
import {
  ComboInput,
  FieldGrid,
  FormSection,
  TextInput,
  useBinder,
} from '../../../common/form/Fields';
import { useText } from '../../../common/i18n';
import { useNamespaceNames } from '../../../hooks/useOcmList';
import { KubeJson } from '../../../resources/models/common';
import { crdByKind } from '../../../resources/registry';
import { KeyValueEditor } from './SelectorEditor';

/**
 * Name, namespace and labels of the edited object. Name and namespace are fixed when editing an
 * existing object (they identify it).
 */
export function MetadataFields({
  value,
  onChange,
  mode,
  nameHelp,
  namespaceHelp,
  namespaceOptions,
  showLabels = true,
}: {
  value: KubeJson;
  onChange: (next: KubeJson) => void;
  mode: 'create' | 'edit';
  nameHelp?: string;
  namespaceHelp?: string;
  /** Namespace suggestions; defaults to the namespaces of the cluster. */
  namespaceOptions?: string[];
  showLabels?: boolean;
}) {
  const { t } = useText();
  const bind = useBinder(value, onChange);
  const namespaces = useNamespaceNames();
  const namespaced = isNamespacedKind(value.kind);
  const [labelsOpen, setLabelsOpen] = React.useState(
    Object.keys(value.metadata?.labels || {}).length > 0
  );
  const info = crdByKind(value.kind);
  return (
    <FormSection
      title={t('General')}
      icon={info?.icon || 'mdi:card-text-outline'}
      description={info?.description}
      docsUrl={info?.docsUrl}
    >
      <FieldGrid columns={namespaced ? 2 : 1}>
        <TextInput
          {...bind<string>(['metadata', 'name'])}
          label={t('Name')}
          required
          disabled={mode === 'edit'}
          help={nameHelp}
        />
        {namespaced && (
          <ComboInput
            {...bind<string>(['metadata', 'namespace'])}
            label={t('Namespace')}
            required
            disabled={mode === 'edit'}
            options={namespaceOptions || namespaces}
            help={namespaceHelp}
          />
        )}
      </FieldGrid>
      {showLabels && (
        <Box sx={{ mt: 1.5 }}>
          <Link component="button" type="button" onClick={() => setLabelsOpen(o => !o)}>
            {labelsOpen ? t('Hide labels') : t('Labels')}
          </Link>
          <Collapse in={labelsOpen}>
            <Box sx={{ mt: 1 }}>
              <KeyValueEditor
                {...bind<Record<string, string>>(['metadata', 'labels'])}
                addLabel={t('Add label')}
              />
            </Box>
          </Collapse>
        </Box>
      )}
    </FormSection>
  );
}
