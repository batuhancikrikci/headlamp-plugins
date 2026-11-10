import { Icon } from '@iconify/react';
import { Box, FormControlLabel, Switch, Tooltip, Typography } from '@mui/material';
import React from 'react';
import { useText } from '../../common/i18n';
import { Compliance, complianceMatrix, PolicyJson } from '../../resources/models/policy';
import { ClusterLink, ResourceRefLink } from '../common/ResourceRefLink';

const CELL: Record<Compliance | 'none', { icon: string; color: string; label: string }> = {
  Compliant: { icon: 'mdi:check-circle', color: 'success.main', label: 'Compliant' },
  NonCompliant: { icon: 'mdi:close-circle', color: 'error.main', label: 'NonCompliant' },
  Pending: { icon: 'mdi:clock-outline', color: 'warning.main', label: 'Pending' },
  Terminating: { icon: 'mdi:delete-clock-outline', color: 'text.secondary', label: 'Terminating' },
  none: { icon: 'mdi:minus', color: 'text.disabled', label: 'Not placed' },
};

function Cell({ value, policy, cluster }: { value?: Compliance; policy: string; cluster: string }) {
  const { t } = useText();
  const cell = CELL[value || 'none'];
  const text = `${policy} · ${cluster}: ${t(cell.label)}`;
  return (
    <Tooltip title={text}>
      <Box
        role="img"
        aria-label={text}
        sx={{ color: cell.color, display: 'flex', justifyContent: 'center' }}
      >
        <Icon icon={cell.icon} width={18} />
      </Box>
    </Tooltip>
  );
}

/** Compliance of every root policy on every cluster it is placed on, in one grid. */
export function ComplianceMatrix({ policies }: { policies: PolicyJson[] }) {
  const { t } = useText();
  const [problemsOnly, setProblemsOnly] = React.useState(false);
  const matrix = React.useMemo(
    () => complianceMatrix(policies, problemsOnly),
    [policies, problemsOnly]
  );

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
        <FormControlLabel
          control={
            <Switch checked={problemsOnly} onChange={e => setProblemsOnly(e.target.checked)} />
          }
          label={t('Only non-compliant and pending')}
        />
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }} aria-label={t('Legend')}>
          {(['Compliant', 'NonCompliant', 'Pending', 'none'] as const).map(key => (
            <Box key={key} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Box sx={{ color: CELL[key].color, display: 'flex' }}>
                <Icon icon={CELL[key].icon} width={16} />
              </Box>
              <Typography variant="body2" color="text.secondary">
                {t(CELL[key].label)}
              </Typography>
            </Box>
          ))}
        </Box>
      </Box>
      {matrix.rows.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
          {problemsOnly
            ? t('Every placed policy is compliant on every cluster.')
            : t('No policy is placed on a cluster yet.')}
        </Typography>
      ) : (
        <Box sx={{ overflow: 'auto', maxHeight: 640, border: 1, borderColor: 'divider' }}>
          <Box
            component="table"
            sx={{
              borderCollapse: 'collapse',
              '& th, & td': {
                borderBottom: 1,
                borderColor: 'divider',
                p: 0.75,
                fontSize: 13,
                whiteSpace: 'nowrap',
              },
              '& thead th': { position: 'sticky', top: 0, bgcolor: 'background.paper', zIndex: 1 },
              '& tbody th': { position: 'sticky', left: 0, bgcolor: 'background.paper' },
            }}
          >
            <thead>
              <tr>
                <Box component="th" sx={{ textAlign: 'left' }}>
                  {t('Policy')}
                </Box>
                {matrix.clusters.map(cluster => (
                  <th key={cluster}>
                    <ClusterLink name={cluster} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matrix.rows.map(({ policy, cells }) => {
                const name = `${policy.metadata.namespace}/${policy.metadata.name}`;
                return (
                  <tr key={name}>
                    <Box component="th" scope="row" sx={{ textAlign: 'left', fontWeight: 400 }}>
                      <ResourceRefLink
                        kind="Policy"
                        name={policy.metadata.name}
                        namespace={policy.metadata.namespace}
                        qualified
                      />
                    </Box>
                    {matrix.clusters.map(cluster => (
                      <td key={cluster}>
                        <Cell value={cells[cluster]} policy={name} cluster={cluster} />
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </Box>
        </Box>
      )}
    </Box>
  );
}
