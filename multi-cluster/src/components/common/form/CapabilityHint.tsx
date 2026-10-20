import { Alert } from '@mui/material';
import React from 'react';
import { useText } from '../../../common/i18n';
import { CapabilityResult } from '../../../hooks/useDiscovery';

/** Hint shown for a version-dependent field. */
export function CapabilityHint({ capability }: { capability: CapabilityResult }) {
  const { t } = useText();
  if (capability.state === 'yes') return null;
  return (
    <Alert severity={capability.state === 'no' ? 'warning' : 'info'} sx={{ mb: 1.5 }}>
      {capability.state === 'no'
        ? t(
            '{{label}} is not supported by the API version of this hub (requires OCM {{since}} or later).',
            {
              label: capability.label,
              since: capability.since,
            }
          )
        : t(
            '{{label}} requires OCM {{since}} or later. The CRD schema could not be read to confirm support.',
            {
              label: capability.label,
              since: capability.since,
            }
          )}
    </Alert>
  );
}
