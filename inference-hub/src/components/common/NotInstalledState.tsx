import { Box, Link, Typography } from '@mui/material';
import React from 'react';
import { t } from '../../common/i18n';
import { EmptyState } from '../../common/States';
import { ResourceId, RESOURCES, StackId, STACKS } from '../../resources/definitions';
import { CopyableCode } from './CopyableCode';

/** Explains which stack is missing for the given resources and how to install it. */
export function NotInstalledState({
  resources,
  title,
}: {
  resources: ResourceId[];
  title?: string;
}) {
  const stackIds = Array.from(new Set(resources.map(id => RESOURCES[id].stack))) as StackId[];
  const stacks = STACKS.filter(s => stackIds.includes(s.id));
  const kinds = resources.map(id => RESOURCES[id].kind).join(', ');
  return (
    <EmptyState
      icon="mdi:package-variant-remove"
      title={
        title ||
        t('{{stack}} is not installed in this cluster', {
          stack: stacks.map(s => s.name).join(' / '),
        })
      }
      description={
        <>
          <Typography variant="body2" color="text.secondary">
            {t('The API server does not serve {{kinds}}.', { kinds })}
          </Typography>
          {stacks.map(stack => (
            <Box key={stack.id} sx={{ mt: 2, textAlign: 'left' }}>
              <Typography variant="body2" sx={{ mb: 0.5 }}>
                {stack.installHint}
              </Typography>
              {stack.installCommand && <CopyableCode code={stack.installCommand} />}
              <Link href={stack.docsUrl} target="_blank" rel="noopener noreferrer" variant="body2">
                {t('{{name}} installation guide', { name: stack.name })}
              </Link>
            </Box>
          ))}
        </>
      }
    />
  );
}
