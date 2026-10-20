import { Icon } from '@iconify/react';
import { Box, Button, Chip, Drawer, IconButton, Tooltip } from '@mui/material';
import React from 'react';
import { t } from '../i18n';
import { CRDDocsViewer } from './CRDDocsViewer';

export interface DocsTarget {
  apiVersion: string;
  kind: string;
}

/**
 * "Documentation" button that opens the CRD documentation in a side panel, so the page or form
 * stays visible. The object whose set fields are marked comes from `value`, or from `getValue`
 * when the panel opens (e.g. on detail pages). With several `targets` (e.g. next to a button
 * that creates different kinds), the panel lets the user switch between them.
 */
export function DocsDrawer({
  apiVersion,
  kind,
  targets,
  value,
  getValue,
  iconOnly,
}: {
  apiVersion?: string;
  kind?: string;
  targets?: DocsTarget[];
  value?: unknown;
  getValue?: () => unknown;
  iconOnly?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [selected, setSelected] = React.useState(0);
  const [opened, setOpened] = React.useState<unknown>(undefined);
  const all = targets ?? (kind ? [{ apiVersion: apiVersion || '', kind }] : []);
  const active = all[Math.min(selected, all.length - 1)];

  const show = () => {
    try {
      setOpened(getValue?.());
    } catch {
      setOpened(undefined);
    }
    setOpen(true);
  };

  return (
    <>
      {iconOnly ? (
        <Tooltip title={t('Documentation')}>
          <span>
            <IconButton aria-label={t('Documentation')} onClick={show} disabled={!active}>
              <Icon icon="mdi:book-open-variant" />
            </IconButton>
          </span>
        </Tooltip>
      ) : (
        <Button
          size="small"
          startIcon={<Icon icon="mdi:book-open-variant" />}
          onClick={show}
          disabled={!active}
        >
          {t('Documentation')}
        </Button>
      )}
      <Drawer
        anchor="right"
        open={open}
        onClose={() => setOpen(false)}
        // Above dialogs, since the drawer is also opened from form dialogs.
        sx={{ zIndex: theme => theme.zIndex.modal + 1 }}
        PaperProps={{ sx: { width: { xs: '100vw', sm: 640, lg: 760 } } }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 1, pl: 2 }}>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', flexGrow: 1 }}>
            {all.length > 1 &&
              all.map((target, i) => (
                <Chip
                  key={`${target.apiVersion}|${target.kind}`}
                  label={target.kind}
                  size="small"
                  color={target === active ? 'primary' : 'default'}
                  variant={target === active ? 'filled' : 'outlined'}
                  onClick={() => setSelected(i)}
                />
              ))}
          </Box>
          <IconButton aria-label={t('Close documentation')} onClick={() => setOpen(false)}>
            <Icon icon="mdi:close" />
          </IconButton>
        </Box>
        <Box sx={{ flexGrow: 1, minHeight: 0, mt: all.length > 1 ? 0 : -6 }}>
          {open && active && (
            <CRDDocsViewer
              key={`${active.apiVersion}|${active.kind}`}
              apiVersion={active.apiVersion}
              kind={active.kind}
              value={value ?? opened}
            />
          )}
        </Box>
      </Drawer>
    </>
  );
}
