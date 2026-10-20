import { Typography } from '@mui/material';
import React from 'react';
import { useText } from '../../common/i18n';
import { ListState } from '../../common/States';
import { useNodes } from '../../hooks/useClusterData';
import { LabelSelector } from '../../resources/types';
import { selectedNodes } from '../../utils/relations';
import { ResourceRefList } from './ResourceRefLink';

/** Nodes matched by a node selector, as links (a missing selector matches every node). */
export function MatchingNodes({
  selector,
  emptyMessage,
}: {
  selector: LabelSelector | null | undefined;
  emptyMessage?: string;
}) {
  const { t } = useText();
  const nodes = useNodes();
  return (
    <ListState items={nodes.items} error={nodes.error} what={t('nodes')} dense>
      {items => {
        const matched = selectedNodes(selector, items);
        if (matched.length === 0) {
          return (
            <Typography variant="body2" color="warning.main">
              {emptyMessage || t('No node matches this selector.')}
            </Typography>
          );
        }
        return (
          <ResourceRefList
            max={50}
            refs={matched.map(n => ({ kind: 'Node', name: n.metadata.name }))}
          />
        );
      }}
    </ListState>
  );
}
