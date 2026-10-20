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
import { servedApiVersion } from '../../../api/discovery';
import { ResourceEditor, ResourceFormComponent } from '../../../common/form/ResourceEditor';
import { useText } from '../../../common/i18n';
import { cleanForEdit } from '../../../common/objects';
import { CRDInfo } from '../../../resources/registry';
import { KubeJson } from '../../../resources/types';
import { newResource } from '../../../utils/templates';

/** A standalone guided flow that may create several resources (e.g. the BGP setup wizard). */
export interface SetupWizard {
  id: string;
  label: string;
  icon: string;
  Dialog: React.ComponentType<{ open: boolean; onClose: () => void }>;
}

export interface EditingConfig {
  Form?: ResourceFormComponent;
  /** Step-by-step variant of the form for creating a single resource. */
  Wizard?: ResourceFormComponent;
  /** Multi-resource wizards offered from this kind's create menu. */
  setupWizards?: SetupWizard[];
}

type CreateMode = 'form' | 'wizard' | 'yaml';

interface CreateOption {
  id: string;
  label: string;
  icon: string;
  run: () => void;
}

/** Split button for creating a resource with a wizard, the form or raw YAML. */
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
  const [setup, setSetup] = React.useState<SetupWizard | null>(null);

  const open = (m: CreateMode) => {
    setAnchor(null);
    setItem(
      newResource(crd.kind, servedApiVersion(crd.plural, getCluster()), namespace || 'default')
    );
    setMode(m);
  };

  const options: CreateOption[] = [
    ...(editing.setupWizards || []).map(wizard => ({
      id: wizard.id,
      label: wizard.label,
      icon: wizard.icon,
      run: () => {
        setAnchor(null);
        setSetup(wizard);
      },
    })),
    ...(editing.Wizard
      ? [
          {
            id: 'wizard',
            label: t('Create with wizard'),
            icon: 'mdi:wizard-hat',
            run: () => open('wizard'),
          },
        ]
      : []),
    ...(editing.Form
      ? [
          {
            id: 'form',
            label: t('Create with form'),
            icon: 'mdi:form-select',
            run: () => open('form'),
          },
        ]
      : []),
    { id: 'yaml', label: t('Create from YAML'), icon: 'mdi:code-braces', run: () => open('yaml') },
  ];
  // The single-resource wizard or form is the default; setup wizards stay in the menu.
  const primary = options.find(o => o.id === 'wizard') || options.find(o => o.id === 'form');
  const primaryOption = primary || options[options.length - 1];
  const SetupDialog = setup?.Dialog;

  return (
    <AuthVisible item={crd.cls} authVerb="create">
      <ButtonGroup
        variant="contained"
        size="small"
        aria-label={t('Create {{kind}}', { kind: crd.label })}
      >
        <Button startIcon={<Icon icon="mdi:plus" />} onClick={primaryOption.run}>
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
          <MenuItem key={o.id} onClick={o.run} selected={o === primaryOption}>
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
          title={t('Create {{kind}}', { kind: crd.label })}
          initialItem={item}
          mode="create"
          Form={mode === 'wizard' ? editing.Wizard : mode === 'form' ? editing.Form : undefined}
          wizard={mode === 'wizard'}
        />
      )}
      {SetupDialog && <SetupDialog open onClose={() => setSetup(null)} />}
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
