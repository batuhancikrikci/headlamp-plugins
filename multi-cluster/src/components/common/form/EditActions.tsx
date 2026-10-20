import { Icon } from '@iconify/react';
import { AuthVisible } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { KubeObject } from '@kinvolk/headlamp-plugin/lib/K8s/cluster';
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
import { chosenApiVersion } from '../../../api/discovery';
import { ResourceEditor, ResourceFormComponent } from '../../../common/form/ResourceEditor';
import { useText } from '../../../common/i18n';
import { cleanForEdit } from '../../../common/objects';
import { useAvailability } from '../../../hooks/useDiscovery';
import { KubeJson } from '../../../resources/models/common';
import { CRDInfo } from '../../../resources/registry';
import { newResource } from '../../../utils/templates';

/** A guided flow that may create several resources (e.g. the import cluster wizard). */
export interface WizardLauncher {
  id: string;
  label: string;
  icon: string;
  Dialog: React.ComponentType<{ open: boolean; onClose: () => void }>;
}

export interface EditingConfig {
  Form?: ResourceFormComponent;
  /** Wizards offered from this kind's create menu (the first one is the default action). */
  wizards?: WizardLauncher[];
}

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
  const availability = useAvailability();
  const [anchor, setAnchor] = React.useState<HTMLElement | null>(null);
  const [item, setItem] = React.useState<{ json: KubeJson; yaml: boolean } | null>(null);
  const [wizard, setWizard] = React.useState<WizardLauncher | null>(null);
  const apiVersion = chosenApiVersion(availability, crd) || `${crd.group}/${crd.versions[0]}`;

  const openEditor = (yaml: boolean) => {
    setAnchor(null);
    setItem({ json: newResource(crd.kind, apiVersion, namespace), yaml });
  };

  const options: CreateOption[] = [
    ...(editing.wizards || []).map(w => ({
      id: w.id,
      label: w.label,
      icon: w.icon,
      run: () => {
        setAnchor(null);
        setWizard(w);
      },
    })),
    ...(editing.Form
      ? [
          {
            id: 'form',
            label: t('Create with form'),
            icon: 'mdi:form-select',
            run: () => openEditor(false),
          },
        ]
      : []),
    {
      id: 'yaml',
      label: t('Create from YAML'),
      icon: 'mdi:code-braces',
      run: () => openEditor(true),
    },
  ];
  const primary = options[0];
  const WizardDialog = wizard?.Dialog;

  return (
    <AuthVisible item={crd.cls} authVerb="create" namespace={namespace}>
      <ButtonGroup
        variant="contained"
        size="small"
        aria-label={t('Create {{kind}}', { kind: crd.label })}
      >
        <Button
          startIcon={<Icon icon={primary.id === 'yaml' ? 'mdi:plus' : primary.icon} />}
          onClick={primary.run}
        >
          {primary.id === 'yaml' || primary.id === 'form' ? t('Create') : primary.label}
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
          <MenuItem key={o.id} onClick={o.run} selected={o === primary}>
            <ListItemIcon>
              <Icon icon={o.icon} />
            </ListItemIcon>
            <ListItemText>{o.label}</ListItemText>
          </MenuItem>
        ))}
      </Menu>
      {item && (
        <ResourceEditor
          open
          onClose={() => setItem(null)}
          title={t('Create {{kind}}', { kind: crd.label })}
          initialItem={item.json}
          mode="create"
          Form={editing.Form}
          initialTab={item.yaml ? 'yaml' : undefined}
        />
      )}
      {WizardDialog && <WizardDialog open onClose={() => setWizard(null)} />}
    </AuthVisible>
  );
}

/** Header action on detail pages: edit the resource with its guided form (and YAML). */
export function EditWithFormAction({
  item,
  Form,
}: {
  item: KubeObject | null;
  Form?: ResourceFormComponent;
}) {
  const { t } = useText();
  const [initial, setInitial] = React.useState<KubeJson | null>(null);
  if (!item || !Form) return null;
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
          Form={Form}
        />
      )}
    </AuthVisible>
  );
}
