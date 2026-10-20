import { Icon } from '@iconify/react';
import { SimpleTable } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Alert, Box, Chip, CircularProgress, Typography } from '@mui/material';
import React from 'react';
import { useText } from '../../common/i18n';
import { useOcmList } from '../../hooks/useOcmList';
import {
  boundSets,
  ManagedClusterJson,
  ManagedClusterSetBindingJson,
  ManagedClusterSetJson,
} from '../../resources/models/cluster';
import { PlacementSpec } from '../../resources/models/placement';
import { EXCLUSION_TEXT, PreviewCluster, previewPlacement } from '../../utils/placementPreview';
import { ClusterLink } from '../common/ResourceRefLink';
import { HealthLabel, StringArray } from '../common/Shared';

/**
 * Live preview of the clusters a placement spec selects, from the clusters, sets and bindings
 * visible to the user. Explains why each excluded cluster is excluded.
 */
export function PlacementPreviewPanel({
  spec,
  namespace,
  extraBoundSets = [],
}: {
  spec: PlacementSpec;
  namespace?: string;
  /** Sets that will be bound before the placement is created (wizards). */
  extraBoundSets?: string[];
}) {
  const { t } = useText();
  const clusters = useOcmList<ManagedClusterJson>('ManagedCluster');
  const sets = useOcmList<ManagedClusterSetJson>('ManagedClusterSet');
  const bindings = useOcmList<ManagedClusterSetBindingJson>('ManagedClusterSetBinding', {
    namespace,
  });

  if (!namespace) {
    return (
      <Alert severity="info">{t('Choose a namespace to preview the selected clusters.')}</Alert>
    );
  }
  if (!clusters.items || !sets.items || !bindings.items) {
    const error = clusters.error || sets.error || bindings.error;
    if (error) {
      return (
        <Alert severity="warning">
          {t('The preview needs read access to managed clusters, cluster sets and bindings.')}
        </Alert>
      );
    }
    return <CircularProgress size={20} />;
  }

  const preview = previewPlacement(spec, {
    clusters: clusters.items,
    sets: sets.items,
    boundSets: [...boundSets(bindings.items, namespace), ...extraBoundSets],
  });

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 1, flexWrap: 'wrap' }}>
        <Typography variant="h5" component="div" sx={{ fontWeight: 700 }}>
          {preview.selectedCount}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t('of {{total}} cluster(s) would be selected from {{sets}}', {
            total: preview.clusters.length,
            sets:
              preview.eligibleSets.length > 0
                ? preview.eligibleSets.join(', ')
                : t('no eligible cluster set'),
          })}
        </Typography>
      </Box>
      {preview.missingSets.length > 0 && (
        <Alert severity="error" sx={{ mb: 1 }}>
          {t('These cluster sets do not exist: {{sets}}', { sets: preview.missingSets.join(', ') })}
        </Alert>
      )}
      {preview.unboundSets.length > 0 && (
        <Alert severity="warning" sx={{ mb: 1 }}>
          {t(
            'These cluster sets are not bound to namespace {{ns}}, so the placement cannot use them: {{sets}}',
            {
              ns: namespace,
              sets: preview.unboundSets.join(', '),
            }
          )}
        </Alert>
      )}
      {preview.eligibleSets.length === 0 &&
        preview.missingSets.length === 0 &&
        preview.unboundSets.length === 0 && (
          <Alert severity="warning" sx={{ mb: 1 }}>
            {t(
              'No cluster set is bound to namespace {{ns}}. Bind at least one set (ManagedClusterSetBinding).',
              { ns: namespace }
            )}
          </Alert>
        )}
      {preview.approximate && (
        <Alert severity="info" icon={<Icon icon="mdi:information-outline" />} sx={{ mb: 1 }}>
          {t(
            'CEL selectors and prioritizer scores are evaluated by the scheduler only; the real decision can differ.'
          )}
        </Alert>
      )}
      <SimpleTable
        columns={[
          { label: t('Cluster'), getter: (c: PreviewCluster) => <ClusterLink name={c.name} /> },
          {
            label: t('Selected'),
            getter: (c: PreviewCluster) =>
              c.selected ? (
                <HealthLabel health="success" label={t('Selected')} />
              ) : (
                <HealthLabel health="unknown" label={t('Excluded')} />
              ),
          },
          {
            label: t('Reason'),
            getter: (c: PreviewCluster) =>
              c.reasons.length === 0 ? (
                '-'
              ) : (
                <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                  {c.reasons.map(r => (
                    <Chip
                      key={r}
                      size="small"
                      variant="outlined"
                      label={
                        r === 'taint'
                          ? `${t(EXCLUSION_TEXT[r])}: ${c.blockingTaints
                              .map(tt => tt.key)
                              .join(', ')}`
                          : t(EXCLUSION_TEXT[r])
                      }
                    />
                  ))}
                </Box>
              ),
          },
          { label: t('Sets'), getter: (c: PreviewCluster) => <StringArray items={c.sets} /> },
        ]}
        data={preview.clusters as unknown as Array<Record<string, unknown>>}
        emptyMessage={t('No managed clusters.')}
      />
    </Box>
  );
}
