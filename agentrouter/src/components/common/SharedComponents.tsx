import { Icon } from '@iconify/react';
import { Router } from '@kinvolk/headlamp-plugin/lib';
import {
  Link,
  NameValueTable,
  SectionBox,
  SimpleTable,
  StatusLabel,
} from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { KubeObject, KubeObjectInterface } from '@kinvolk/headlamp-plugin/lib/K8s/cluster';
import {
  Box,
  Button,
  ButtonGroup,
  Chip,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Typography,
} from '@mui/material';
import React from 'react';
import { useHistory } from 'react-router-dom';
import { DocsDrawer } from '../../common/docs/DocsDrawer';
import {
  APISchemaName,
  BackendObjectReference,
  Condition,
  LLMRequestCost,
  LocalPolicyTargetReference,
  ParentReference,
  SecretObjectReference,
} from '../../resources/common';
import { createRoute, detailRoute } from '../../routes';
import { applyAll } from '../../utils/apply';
import { newResource } from '../../utils/templates';
import { schemaLogos } from './ProviderLogos';
import { ResourceEditorDialog } from './ResourceEditorDialog';

/**
 * Format an ISO 8601 timestamp to a human-readable relative string.
 */
export function formatRelativeTime(isoString: string): string {
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return isoString;

    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);

    if (diffSec < 60) return `${diffSec}s ago`;
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHour < 24) return `${diffHour}h ago`;
    if (diffDay < 30) return `${diffDay}d ago`;
    return date.toLocaleDateString();
  } catch {
    return isoString;
  }
}

/**
 * Renders a status chip with appropriate color based on condition status.
 * - 'True' → success (green)
 * - 'False' → error (red)
 * - 'Unknown' → warning (orange)
 */
export function StatusChip({
  type,
  statusValue,
}: {
  type: string;
  statusValue: 'True' | 'False' | 'Unknown' | string;
}) {
  let status: 'success' | 'warning' | 'error' | '' = '';
  if (statusValue === 'True') status = 'success';
  else if (statusValue === 'False') status = 'error';
  else if (statusValue === 'Unknown') status = 'warning';

  return (
    <StatusLabel status={status}>
      {type}: {statusValue}
    </StatusLabel>
  );
}

/**
 * Shows inline status for list views.
 * Finds the 'Accepted' condition first, then falls back to the first condition.
 */
export function PolicyStatusSummary({ conditions }: { conditions?: Condition[] }) {
  if (!conditions || conditions.length === 0) {
    return <Typography variant="body2">-</Typography>;
  }

  const primaryCondition = conditions.find(
    c => c.type === 'Accepted' || c.type === 'Programmed' || c.type === 'ResolvedRefs'
  );

  if (!primaryCondition) {
    const first = conditions[0];
    return <StatusChip type={first.type} statusValue={first.status} />;
  }

  return <StatusChip type={primaryCondition.type} statusValue={primaryCondition.status} />;
}

/**
 * Full conditions table for detail pages.
 * Shows type, status, reason, message, and relative time.
 */
export function ConditionsTable({ conditions }: { conditions?: Condition[] }) {
  if (!conditions || conditions.length === 0) {
    return <Typography variant="body2">No conditions reported.</Typography>;
  }

  return (
    <NameValueTable
      rows={conditions.map(c => ({
        name: (
          <Box>
            <StatusChip type={c.type} statusValue={c.status} />
          </Box>
        ),
        value: (
          <Box>
            {c.reason && (
              <Typography variant="body2" sx={{ fontWeight: 500 }}>
                {c.reason}
              </Typography>
            )}
            {c.message && (
              <Typography variant="body2" color="text.secondary">
                {c.message}
              </Typography>
            )}
            {c.lastTransitionTime && (
              <Typography variant="caption" color="text.secondary" title={c.lastTransitionTime}>
                {formatRelativeTime(c.lastTransitionTime)}
              </Typography>
            )}
          </Box>
        ),
      }))}
    />
  );
}

/**
 * Shows a backend reference as a chip.
 * Displays group/kind/name when group or kind are present, otherwise just the name.
 */
export function BackendRefChip({ backendRef }: { backendRef: BackendObjectReference }) {
  const parts: string[] = [];
  if (backendRef.group) parts.push(backendRef.group);
  if (backendRef.kind) parts.push(backendRef.kind);
  parts.push(backendRef.name);
  if (backendRef.namespace) parts.push(`(${backendRef.namespace})`);
  if (backendRef.port) parts.push(`:${backendRef.port}`);

  return (
    <Chip
      label={parts.join('/')}
      size="small"
      color="primary"
      variant="outlined"
      sx={{
        mr: 0.5,
        mb: 0.5,
        height: 'auto',
        '& .MuiChip-label': {
          display: 'block',
          whiteSpace: 'normal',
          wordWrap: 'break-word',
          padding: '4px 8px',
        },
      }}
    />
  );
}

/**
 * Shows a parent (Gateway) reference as a chip.
 * Renders kind/name with optional namespace and sectionName.
 */
export function ParentRefChip({ parentRef }: { parentRef: ParentReference }) {
  const kind = parentRef.kind || 'Gateway';
  const ns = parentRef.namespace ? `${parentRef.namespace}/` : '';
  const section = parentRef.sectionName ? ` (${parentRef.sectionName})` : '';
  const port = parentRef.port ? `:${parentRef.port}` : '';
  const label = `${kind}/${ns}${parentRef.name}${port}${section}`;

  return (
    <Chip
      label={label}
      size="small"
      color="info"
      variant="outlined"
      sx={{
        mr: 0.5,
        mb: 0.5,
        height: 'auto',
        '& .MuiChip-label': {
          display: 'block',
          whiteSpace: 'normal',
          wordWrap: 'break-word',
          padding: '4px 8px',
        },
      }}
    />
  );
}

/**
 * Color mapping for API schema providers.
 * 'secondary' is deliberately not used: themes may define it as a light background tint
 * (e.g. #E3EDF7), which is unreadable as chip text on a light surface.
 */
const SCHEMA_COLOR_MAP: Record<string, 'primary' | 'warning' | 'info' | 'success' | 'default'> = {
  OpenAI: 'primary',
  AWSBedrock: 'warning',
  AWSAnthropic: 'warning',
  AzureOpenAI: 'info',
  GCPVertexAI: 'success',
  GCPAnthropic: 'success',
  Anthropic: 'default',
  Cohere: 'default',
};

/**
 * Shows an API schema name as a colored chip with the provider logo(s).
 * Color is determined by the provider type.
 */
export function SchemaChip({ schemaName }: { schemaName: APISchemaName | string }) {
  const color = SCHEMA_COLOR_MAP[schemaName] || 'default';

  return (
    <Chip
      label={schemaName}
      icon={schemaLogos(schemaName)}
      size="small"
      color={color}
      variant="outlined"
      sx={{ mr: 0.5, mb: 0.5, '& .MuiChip-icon': { ml: 0.75, mr: -0.25 } }}
    />
  );
}

/**
 * Renders an array of strings as chips.
 */
export function StringArray({ items }: { items?: string[] }) {
  if (!items || items.length === 0) return null;
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
      {items.map((item, i) => (
        <Chip key={i} label={item} size="small" variant="outlined" sx={{ mb: 0.5 }} />
      ))}
    </Box>
  );
}

/**
 * Shows a LocalPolicyTargetReference as a chip.
 * Displays group/kind/name.
 */
export function TargetRefChip({ targetRef }: { targetRef: LocalPolicyTargetReference }) {
  const label = [targetRef.group, targetRef.kind, targetRef.name].filter(Boolean).join('/');

  return (
    <Chip
      label={label}
      size="small"
      color="error"
      variant="outlined"
      sx={{
        mr: 0.5,
        mb: 0.5,
        height: 'auto',
        '& .MuiChip-label': {
          display: 'block',
          whiteSpace: 'normal',
          wordWrap: 'break-word',
          padding: '4px 8px',
        },
      }}
    />
  );
}

/**
 * Renders a secret reference as `namespace/name` (namespace only when it differs from the owner).
 */
export function SecretRefLabel({ secretRef }: { secretRef?: SecretObjectReference }) {
  if (!secretRef?.name) return <>-</>;
  const ns = secretRef.namespace ? `${secretRef.namespace}/` : '';
  return (
    <Chip
      label={`Secret: ${ns}${secretRef.name}`}
      size="small"
      variant="outlined"
      sx={{ fontFamily: 'monospace' }}
    />
  );
}

type Scalar = string | number | boolean | null | undefined;

/** Scalars and arrays of scalars render inline as `key: value`. */
const isInline = (v: unknown): boolean =>
  !v ||
  typeof v !== 'object' ||
  (Array.isArray(v) && v.every(item => item === null || typeof item !== 'object'));

function formatInline(v: unknown): string {
  if (Array.isArray(v)) return v.map(item => formatInline(item)).join(', ');
  if (v === null || v === undefined || v === '') return '-';
  return String(v as Scalar);
}

/** Bordered block of `key: value` rows (the look used by the monitoring plugin's Receivers). */
export function KeyValueBlock({ entries }: { entries: Array<[string, React.ReactNode]> }) {
  return (
    <Box sx={{ pl: 1.5, py: 0.5, borderLeft: 2, borderColor: 'info.main' }}>
      {entries.map(([key, value]) => (
        <Box key={key} sx={{ display: 'flex', mb: 0.5 }}>
          <Typography
            variant="body2"
            sx={{ fontWeight: 600, minWidth: 120, pr: 1, color: 'text.primary', flexShrink: 0 }}
          >
            {key}:
          </Typography>
          <Typography
            variant="body2"
            component="div"
            sx={{ fontFamily: 'monospace', color: 'text.secondary', wordBreak: 'break-word' }}
          >
            {value}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}

/** Uppercase caption used above each nested group. */
function GroupCaption({ children }: { children: React.ReactNode }) {
  return (
    <Typography
      variant="caption"
      sx={{
        display: 'block',
        mb: 0.5,
        fontWeight: 700,
        color: 'text.secondary',
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
      }}
    >
      {children}
    </Typography>
  );
}

/**
 * Renders an arbitrary spec fragment readably: summary chips for nested groups, a bordered
 * `key: value` block for flat fields, and an uppercase caption + block per nested group.
 */
export function StructuredValue({
  value,
  showSummary = true,
}: {
  value: unknown;
  showSummary?: boolean;
}) {
  if (isInline(value)) {
    return (
      <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
        {formatInline(value)}
      </Typography>
    );
  }

  if (Array.isArray(value)) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {value.map((item, i) => (
          <StructuredValue key={i} value={item} showSummary={false} />
        ))}
      </Box>
    );
  }

  const entries = Object.entries(value as Record<string, unknown>);
  const inline = entries.filter(([, v]) => isInline(v));
  const nested = entries.filter(([, v]) => !isInline(v));

  return (
    <Box>
      {showSummary && nested.length > 0 && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 1.5 }}>
          {nested.map(([k, v]) => (
            <Chip
              key={k}
              size="small"
              variant="outlined"
              label={Array.isArray(v) ? `${k} (${v.length})` : k}
            />
          ))}
        </Box>
      )}
      {inline.length > 0 && (
        <Box sx={{ mb: nested.length > 0 ? 2 : 0 }}>
          <KeyValueBlock entries={inline.map(([k, v]) => [k, formatInline(v)])} />
        </Box>
      )}
      {nested.map(([k, v]) => (
        <Box key={k} sx={{ mb: 2, '&:last-child': { mb: 0 } }}>
          <GroupCaption>{k}</GroupCaption>
          <StructuredValue value={v} showSummary={false} />
        </Box>
      ))}
    </Box>
  );
}

/**
 * Renders an opaque spec fragment (types the plugin does not model field by field).
 */
export function ObjectBlock({ value }: { value: unknown }) {
  if (value === undefined || value === null) return <>-</>;
  return <StructuredValue value={value} />;
}

/** Minimal shape of the plugin's CRD classes needed for cross-reference tables. */
type RelatedResource = KubeObject & { conditions: Condition[] };

/**
 * Section listing resources related to the one being viewed, each linked to its detail page.
 * Shows a loading hint while `items` is null and an empty message when nothing is related.
 */
export function RelatedResourcesSection({
  title,
  items,
  emptyMessage,
  description,
  extraColumns = [],
}: {
  title: string;
  items: RelatedResource[] | null;
  emptyMessage: string;
  description?: React.ReactNode;
  extraColumns?: Array<{ label: string; getter: (item: RelatedResource) => React.ReactNode }>;
}) {
  return (
    <SectionBox title={title}>
      {description && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          {description}
        </Typography>
      )}
      {items === null ? (
        <Typography variant="body2" color="text.secondary">
          Loading…
        </Typography>
      ) : items.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {emptyMessage}
        </Typography>
      ) : (
        <SimpleTable
          data={items}
          columns={[
            {
              label: 'Name',
              getter: (item: RelatedResource) => (
                <Link kubeObject={item}>{item.metadata.name}</Link>
              ),
            },
            {
              label: 'Namespace',
              getter: (item: RelatedResource) => item.metadata.namespace || '-',
            },
            ...extraColumns,
            {
              label: 'Status',
              getter: (item: RelatedResource) => (
                <PolicyStatusSummary conditions={item.conditions} />
              ),
            },
          ]}
        />
      )}
    </SectionBox>
  );
}

/** Link to a plugin detail route by name/namespace, used when the target object may not exist. */
export function PluginResourceLink({
  routeName,
  name,
  namespace,
}: {
  routeName: string;
  name: string;
  namespace?: string;
}) {
  return (
    <Link routeName={routeName} params={{ name, namespace: namespace || '' }}>
      {name}
    </Link>
  );
}

/** Table of LLM request cost definitions (shared by AI Routes and Gateway Config). */
export function LLMRequestCostsSection({
  costs,
  title = 'LLM Request Costs',
}: {
  costs: LLMRequestCost[];
  title?: string;
}) {
  return (
    <SectionBox title={title}>
      <SimpleTable
        data={costs}
        columns={[
          {
            label: 'Metadata Key',
            getter: (c: LLMRequestCost) => (
              <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                {c.metadataKey}
              </Typography>
            ),
          },
          { label: 'Type', getter: (c: LLMRequestCost) => <Chip size="small" label={c.type} /> },
          {
            label: 'CEL Expression',
            getter: (c: LLMRequestCost) =>
              c.cel ? (
                <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                  {c.cel}
                </Typography>
              ) : (
                '-'
              ),
          },
        ]}
      />
    </SectionBox>
  );
}

/** Header action that opens a plugin create route (wizard or form). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ResourceClassLike = { kind: string; apiVersion: string | string[] } & Record<string, any>;

/**
 * List-page header actions: CRD documentation, and a split Create button (wizard, form or
 * YAML with documentation).
 */
export function CreateButton({
  sidebar,
  label,
  resourceClass,
}: {
  sidebar: string;
  label: string;
  resourceClass: ResourceClassLike;
}) {
  const history = useHistory();
  const [anchor, setAnchor] = React.useState<HTMLElement | null>(null);
  const [yamlItem, setYamlItem] = React.useState<KubeObjectInterface | null>(null);
  const apiVersion = Array.isArray(resourceClass.apiVersion)
    ? resourceClass.apiVersion[0]
    : resourceClass.apiVersion;

  const go = (layout: 'wizard' | 'form') => {
    setAnchor(null);
    history.push(`${Router.createRouteURL(createRoute(sidebar))}?layout=${layout}`);
  };
  const openYaml = () => {
    setAnchor(null);
    setYamlItem(newResource(resourceClass.kind, apiVersion) as KubeObjectInterface);
  };

  /** Applies the YAML and opens the created resource. */
  async function createFromYaml(items: KubeObjectInterface[]) {
    await applyAll(items);
    const primary = items.find(i => i.kind === resourceClass.kind) || items[0];
    setYamlItem(null);
    history.push(
      Router.createRouteURL(detailRoute(sidebar), {
        namespace: primary.metadata?.namespace || '',
        name: primary.metadata?.name || '',
      })
    );
  }

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <DocsDrawer apiVersion={apiVersion} kind={resourceClass.kind} iconOnly />
      <ButtonGroup variant="contained" size="small" aria-label={label}>
        <Button startIcon={<Icon icon="mdi:plus" />} onClick={() => go('wizard')}>
          {label}
        </Button>
        <Button
          aria-label="More create options"
          aria-haspopup="menu"
          onClick={e => setAnchor(e.currentTarget)}
        >
          <Icon icon="mdi:menu-down" />
        </Button>
      </ButtonGroup>
      <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)}>
        <MenuItem onClick={() => go('wizard')}>
          <ListItemIcon>
            <Icon icon="mdi:wizard-hat" />
          </ListItemIcon>
          <ListItemText>Create with wizard</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => go('form')}>
          <ListItemIcon>
            <Icon icon="mdi:form-select" />
          </ListItemIcon>
          <ListItemText>Create with form</ListItemText>
        </MenuItem>
        <MenuItem onClick={openYaml}>
          <ListItemIcon>
            <Icon icon="mdi:code-braces" />
          </ListItemIcon>
          <ListItemText>Create from YAML</ListItemText>
        </MenuItem>
      </Menu>
      {yamlItem && (
        <ResourceEditorDialog
          open
          title={`Create ${resourceClass.kind} from YAML`}
          items={[yamlItem]}
          primaryKind={resourceClass.kind}
          saveLabel="Create"
          onClose={() => setYamlItem(null)}
          onSave={createFromYaml}
        />
      )}
    </Box>
  );
}
