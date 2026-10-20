/** Entry points into the editor: the create menu of list pages and the edit action of details. */
import { Icon } from '@iconify/react';
import { AuthVisible } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { KubeObject } from '@kinvolk/headlamp-plugin/lib/k8s/cluster';
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
import { useAuthorization } from '../../data/useAuthorization';
import { useNamespaceFilter } from '../../data/useNamespaceFilter';
import { servedApiVersion } from '../../discovery/discovery';
import { findKind, kindInfo, KindName } from '../../resources/registry';
import { KubeJson } from '../../resources/types';
import { newResource, TemplateHints } from '../../utils/templates';
import { cleanForEdit } from '../../utils/yaml';
import { EditorVariant, ResourceEditor } from './ResourceEditor';
import { WIZARDS } from './wizards';

const VARIANT_OPTIONS: Record<EditorVariant, { label: string; icon: string }> = {
  wizard: { label: 'Create with wizard', icon: 'mdi:wizard-hat' },
  form: { label: 'Create with form', icon: 'mdi:form-select' },
  yaml: { label: 'Create from YAML', icon: 'mdi:code-braces' },
};

/**
 * Split button that creates a resource with the wizard, the form or plain YAML. It is disabled
 * (with an explanation) when the user is known not to have permission to create the kind.
 */
export function CreateMenu({
  kind,
  hints,
  label = 'Create',
}: {
  kind: KindName;
  hints?: TemplateHints;
  label?: string;
}) {
  const info = kindInfo(kind);
  const namespaces = useNamespaceFilter();
  // New resources go to the namespace the user is looking at, when there is exactly one hint.
  const namespace = info.namespaced
    ? hints?.parent?.namespace && namespaces.length === 0
      ? hints.parent.namespace
      : namespaces[0]
    : undefined;
  const auth = useAuthorization(kind, 'create', namespace);
  // Without a selected namespace the check is cluster-wide; a user limited to some namespaces
  // fails it but may still create there, so only a namespace-specific denial disables the button.
  const denied = auth === 'denied' && (!info.namespaced || !!namespace);

  const [anchor, setAnchor] = React.useState<HTMLElement | null>(null);
  const [editor, setEditor] = React.useState<{ variant: EditorVariant; initial: KubeJson } | null>(
    null
  );

  const variants: EditorVariant[] = [
    ...(WIZARDS[kind] ? (['wizard'] as const) : []),
    'form',
    'yaml',
  ];
  const primary = variants[0];

  const openEditor = (variant: EditorVariant) => {
    setAnchor(null);
    setEditor({
      variant,
      initial: newResource(kind, servedApiVersion(info), {
        namespace: namespace || 'default',
        namespaced: info.namespaced,
        hints,
      }),
    });
  };

  const tooltip = denied
    ? `You do not have permission to create ${info.labelPlural}${
        namespace ? ` in namespace "${namespace}"` : ''
      }`
    : '';

  return (
    <>
      <Tooltip title={tooltip}>
        <span>
          <ButtonGroup
            variant="contained"
            size="small"
            disabled={denied}
            aria-label={`Create ${info.label}`}
          >
            <Button startIcon={<Icon icon="mdi:plus" />} onClick={() => openEditor(primary)}>
              {label}
            </Button>
            <Button
              size="small"
              aria-label={`More ways to create a ${info.label}`}
              aria-haspopup="menu"
              onClick={event => setAnchor(event.currentTarget)}
              sx={{ px: 0.5, minWidth: 32 }}
            >
              <Icon icon="mdi:menu-down" width={20} />
            </Button>
          </ButtonGroup>
        </span>
      </Tooltip>
      <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)}>
        {variants.map(variant => (
          <MenuItem key={variant} onClick={() => openEditor(variant)}>
            <ListItemIcon>
              <Icon icon={VARIANT_OPTIONS[variant].icon} />
            </ListItemIcon>
            <ListItemText>{VARIANT_OPTIONS[variant].label}</ListItemText>
          </MenuItem>
        ))}
      </Menu>
      {editor && (
        <ResourceEditor
          open
          onClose={() => setEditor(null)}
          kind={kind}
          mode="create"
          initial={editor.initial}
          variant={editor.variant}
        />
      )}
    </>
  );
}

/**
 * Header action of detail pages: edit the resource with its guided form. Only rendered when the
 * user may update the object. (Headlamp's own "Edit" action, the plain YAML editor, stays too.)
 */
export function EditWithFormAction({ item }: { item: KubeObject }) {
  const [initial, setInitial] = React.useState<KubeJson | null>(null);
  const info = findKind(item.kind);
  if (!info) return null;

  return (
    <AuthVisible item={item} authVerb="update">
      <Tooltip title="Edit with form">
        <IconButton
          aria-label="Edit with form"
          onClick={() => setInitial(cleanForEdit(item.jsonData as unknown as KubeJson))}
        >
          <Icon icon="mdi:form-select" />
        </IconButton>
      </Tooltip>
      {initial && (
        <ResourceEditor
          open
          onClose={() => setInitial(null)}
          kind={info.kind}
          mode="edit"
          initial={initial}
          variant="form"
        />
      )}
    </AuthVisible>
  );
}
