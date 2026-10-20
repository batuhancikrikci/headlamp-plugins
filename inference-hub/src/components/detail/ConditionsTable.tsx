import { DateLabel, SimpleTable } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Chip, Typography } from '@mui/material';
import React from 'react';
import { t } from '../../common/i18n';
import { Condition } from '../../resources/types';
import { isFailure } from '../../utils/health';

function conditionColor(c: Condition): 'success' | 'error' | 'warning' | 'default' {
  if (c.status === 'True') return 'success';
  if (c.status === 'False' && (isFailure(c.reason) || isFailure(c.message))) return 'error';
  if (c.status === 'False') return 'warning';
  return 'default';
}

export function ConditionsTable({ conditions }: { conditions?: Condition[] }) {
  if (!conditions || conditions.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        {t('The controller has not reported any conditions yet.')}
      </Typography>
    );
  }
  return (
    <SimpleTable
      data={conditions}
      columns={[
        { label: t('Condition'), getter: (c: Condition) => c.type },
        {
          label: t('Status'),
          getter: (c: Condition) => (
            <Chip size="small" color={conditionColor(c)} variant="outlined" label={c.status} />
          ),
        },
        { label: t('Reason'), getter: (c: Condition) => c.reason || '—' },
        {
          label: t('Message'),
          getter: (c: Condition) => (
            <Typography variant="body2" sx={{ wordBreak: 'break-word' }}>
              {c.message || '—'}
            </Typography>
          ),
        },
        {
          label: t('Last transition'),
          getter: (c: Condition) =>
            c.lastTransitionTime ? <DateLabel date={c.lastTransitionTime} /> : '—',
        },
      ]}
    />
  );
}
