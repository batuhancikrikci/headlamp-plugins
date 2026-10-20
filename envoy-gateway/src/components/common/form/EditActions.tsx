import { Icon } from '@iconify/react';
import { AuthVisible } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { KubeObject } from '@kinvolk/headlamp-plugin/lib/K8s/cluster';
import { getCluster } from '@kinvolk/headlamp-plugin/lib/Utils';
import {
  Button,
  ButtonGroup,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Tooltip,
} from '@mui/material';
import React from 'react';
import { ResourceEditor, ResourceFormComponent } from '../../../common/form/ResourceEditor';
import { useText } from '../../../common/i18n';
import { cleanForEdit } from '../../../common/objects';
import { CRDInfo } from '../../../resources/registry';
import { KubeJson } from '../../../resources/types';
import { newResource } from '../../../utils/templates';
import { servedApiVersion } from '../../../utils/versionDiscovery';

export interface EditingConfig {
  Form?: ResourceFormComponent;
  Wizard?: ResourceFormComponent;
}

type CreateMode = 'form' | 'wizard' | 'yaml';

/** Split button for creating a resource with the form, the wizard or raw YAML. */
export function CreateResourceMenu({
  crd,
  editing,
  namespace,
}: {
  crd: CRDInfo;
  editing: EditingConfig;
  namespace?: string;
}) {
  const { t } = useText();
  const [anchor, setAnchor] = React.useState<HTMLElement | null>(null);
  const [mode, setMode] = React.useState<CreateMode | null>(null);
  const [item, setItem] = React.useState<KubeJson | null>(null);
  const primary: CreateMode = editing.Wizard ? 'wizard' : editing.Form ? 'form' : 'yaml';

  const open = (m: CreateMode) => {
    setAnchor(null);
    setItem(
      newResource(crd.kind, servedApiVersion(crd.plural, getCluster()), namespace || 'default')
    );
    setMode(m);
  };

  const options: Array<{ mode: CreateMode; label: string; icon: string }> = [
    ...(editing.Wizard
      ? [{ mode: 'wizard' as const, label: t('Create with wizard'), icon: 'mdi:wizard-hat' }]
      : []),
    ...(editing.Form
      ? [{ mode: 'form' as const, label: t('Create with form'), icon: 'mdi:form-select' }]
      : []),
    { mode: 'yaml', label: t('Create from YAML'), icon: 'mdi:code-braces' },
  ];
  const primaryOption = options.find(o => o.mode === primary)!;

  return (
    <AuthVisible item={crd.cls} authVerb="create">
      <ButtonGroup
        variant="contained"
        size="small"
        aria-label={t('Create {{kind}}', { kind: crd.kind })}
      >
        <Button startIcon={<Icon icon="mdi:plus" />} onClick={() => open(primary)}>
          {t('Create')}
        </Button>
        {options.length > 1 && (
          <Button
            size="small"
            aria-label={t('More create options')}
            aria-haspopup="menu"
            onClick={e => setAnchor(e.currentTarget)}
          >
            <Icon icon="mdi:menu-down" />
          </Button>
        )}
      </ButtonGroup>
      <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)}>
        {options.map(o => (
          <MenuItem key={o.mode} onClick={() => open(o.mode)} selected={o === primaryOption}>
            <ListItemIcon>
              <Icon icon={o.icon} />
            </ListItemIcon>
            <ListItemText>{o.label}</ListItemText>
          </MenuItem>
        ))}
      </Menu>
      {item && mode && (
        <ResourceEditor
          open
          onClose={() => {
            setMode(null);
            setItem(null);
          }}
          title={t('Create {{kind}}', { kind: crd.kind })}
          initialItem={item}
          mode="create"
          Form={mode === 'wizard' ? editing.Wizard : mode === 'form' ? editing.Form : undefined}
          wizard={mode === 'wizard'}
        />
      )}
    </AuthVisible>
  );
}

/** Header action on detail pages: edit the resource with its guided form. */
export function EditWithFormAction({
  item,
  editing,
}: {
  item: KubeObject | null;
  editing: EditingConfig;
}) {
  const { t } = useText();
  const [initial, setInitial] = React.useState<KubeJson | null>(null);
  if (!item || !editing.Form) return null;

  return (
    <AuthVisible item={item} authVerb="update">
      <Tooltip title={t('Edit with form')}>
        <IconButton
          aria-label={t('Edit with form')}
          onClick={() => setInitial(cleanForEdit(item.jsonData) as KubeJson)}
        >
          <Icon icon="mdi:form-select" />
        </IconButton>
      </Tooltip>
      {initial && (
        <ResourceEditor
          open
          onClose={() => setInitial(null)}
          title={t('Edit {{kind}} {{name}}', { kind: item.kind, name: item.metadata?.name })}
          initialItem={initial}
          mode="edit"
          Form={editing.Form}
        />
      )}
    </AuthVisible>
  );
}
