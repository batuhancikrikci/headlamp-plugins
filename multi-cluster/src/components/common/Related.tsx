/**
 * Helpers for list columns and the cross-reference sections of detail pages.
 */
import { SectionBox, SimpleTable } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Typography } from '@mui/material';
import React from 'react';
import { useText } from '../../common/i18n';
import { ListState } from '../../common/States';
import { KubeJson } from '../../resources/models/common';
import { Column, Item } from './Views';

/**
 * A list column over the plain JSON of each row: `getValue` drives sorting and filtering,
 * `render` (optional) the cell.
 */
export function col<J extends KubeJson>(
  id: string,
  label: string,
  getValue: (json: J) => string | number | null | undefined,
  render?: (json: J) => React.ReactNode,
  gridTemplate?: string | number
): Column {
  return {
    id,
    label,
    gridTemplate,
    // The rows of a list are objects of the kind the column was made for.
    getValue: (item: Item) => getValue(item.jsonData as J) ?? '',
    ...(render ? { render: (item: Item) => render(item.jsonData as J) } : {}),
  };
}

export interface RelatedColumn<T> {
  label: string;
  getter: (row: T) => React.ReactNode;
  gridTemplate?: string | number;
}

/** Titled table of related objects with the standard loading / error / empty states. */
export function RelatedTable<T>({
  title,
  items,
  error,
  what,
  columns,
  emptyMessage,
  actions,
  description,
}: {
  title: string;
  items: T[] | null;
  error?: unknown;
  /** For the permission hint: "ManifestWorks". */
  what: string;
  columns: Array<RelatedColumn<T>>;
  emptyMessage: string;
  actions?: React.ReactNode[];
  description?: React.ReactNode;
}) {
  return (
    <SectionBox title={title} headerProps={actions ? { actions } : undefined}>
      {description && (
        <Typography variant="body2" color="text.secondary" component="div" sx={{ mb: 1 }}>
          {description}
        </Typography>
      )}
      <ListState items={items} error={error} what={what}>
        {list => (
          <SimpleTable
            columns={columns.map(c => ({
              label: c.label,
              getter: c.getter,
              gridTemplate: c.gridTemplate,
            }))}
            data={list as Array<Record<string, unknown>>}
            emptyMessage={emptyMessage}
          />
        )}
      </ListState>
    </SectionBox>
  );
}

/** Small "n of m" text. */
export function Ratio({ value, total }: { value: number; total: number }) {
  const { t } = useText();
  return <>{t('{{value}} of {{total}}', { value, total })}</>;
}
