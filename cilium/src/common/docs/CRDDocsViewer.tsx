/**
 * Field documentation for a custom resource, read from its CRD OpenAPI schema in the cluster:
 * breadcrumb navigation, search across all levels, types, required markers, allowed values,
 * defaults, limits and CEL rules. Fields set in `value` are marked.
 *
 * `CRDDocsViewer` loads the schema; `CRDDocsView` only renders a given state (stories, tests).
 */
import { Icon } from '@iconify/react';
import { ApiProxy, K8s } from '@kinvolk/headlamp-plugin/lib';
import {
  Alert,
  Box,
  Breadcrumbs,
  Button,
  Chip,
  CircularProgress,
  Divider,
  IconButton,
  InputAdornment,
  Link,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import React, { useEffect, useState } from 'react';
import { t } from '../i18n';
import {
  childContainer,
  findFields,
  hasChildren,
  pickSchemaVersion,
  resolveSchemaPath,
  schemaLimits,
  SchemaNode,
  SchemaVersion,
  splitApiVersion,
  typeLabel,
  valueAtSchemaPath,
} from './crdSchema';
import { kindDoc } from './kindDocs';

// ─── Loading the schema ─────────────────────────────────────────────────────

interface CRDJson {
  metadata: { name: string };
  spec: { group: string; names: { kind: string }; versions?: SchemaVersion[] };
}

const CRD_ENDPOINT = '/apis/apiextensions.k8s.io/v1/customresourcedefinitions';

class BuiltInKindError extends Error {}

/** The plural of a kind, from API discovery (allowed for every authenticated user). */
async function pluralOf(
  cluster: string,
  group: string,
  version: string,
  kind: string
): Promise<string | undefined> {
  try {
    const list = (await ApiProxy.clusterRequest(`/apis/${group}/${version}`, { cluster })) as {
      resources?: Array<{ name: string; kind: string }>;
    };
    return list.resources?.find(r => r.kind === kind && !r.name.includes('/'))?.name;
  } catch {
    return undefined;
  }
}

async function requestCRD(
  cluster: string,
  group: string,
  version: string,
  kind: string
): Promise<CRDJson> {
  // A single CRD by name only needs "get"; listing all CRDs is the fallback.
  const plural = await pluralOf(cluster, group, version, kind);
  if (plural) {
    try {
      return (await ApiProxy.clusterRequest(`${CRD_ENDPOINT}/${plural}.${group}`, {
        cluster,
      })) as CRDJson;
    } catch (err) {
      if ((err as { status?: number })?.status !== 404) throw err;
    }
  }
  const all = (await ApiProxy.clusterRequest(CRD_ENDPOINT, { cluster })) as { items?: CRDJson[] };
  const match = all.items?.find(c => c.spec.group === group && c.spec.names.kind === kind);
  if (!match) {
    throw new Error(
      t('No CustomResourceDefinition found for {{kind}} ({{group}}).', { kind, group })
    );
  }
  return match;
}

/** CRDs per cluster/group/kind; schemas only change when a CRD is upgraded. */
const crdRequests = new Map<string, Promise<CRDJson>>();

function loadCRD(cluster: string, group: string, version: string, kind: string) {
  if (!group) {
    return Promise.reject(
      new BuiltInKindError(
        t(
          '{{kind}} is a built-in Kubernetes type; field documentation is only available for CRDs.',
          {
            kind,
          }
        )
      )
    );
  }
  const id = [cluster, group, kind].join('/');
  let pending = crdRequests.get(id);
  if (!pending) {
    pending = requestCRD(cluster, group, version, kind);
    crdRequests.set(id, pending);
    pending.catch(() => crdRequests.delete(id)); // a failed request can be retried
  }
  return pending;
}

export type SchemaState =
  | { phase: 'loading' }
  | { phase: 'ready'; crdName: string; version?: string; root: SchemaNode }
  | { phase: 'failed'; message: string; builtIn: boolean; forbidden: boolean };

/** Loads the OpenAPI schema of a kind from its CRD in the current cluster. */
export function useCRDSchema(apiVersion: string | undefined, kind: string | undefined) {
  const cluster = K8s.useCluster() || '';
  const [state, setState] = useState<SchemaState>({ phase: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!apiVersion || !kind) {
      setState({
        phase: 'failed',
        message: t('Set apiVersion and kind to see the documentation.'),
        builtIn: false,
        forbidden: false,
      });
      return;
    }
    let active = true;
    const { group, version } = splitApiVersion(apiVersion);
    setState({ phase: 'loading' });
    loadCRD(cluster, group, version, kind)
      .then(crd => {
        const chosen = pickSchemaVersion(crd.spec.versions, version);
        const root = chosen?.schema?.openAPIV3Schema;
        if (!root) throw new Error(t('The CRD has no OpenAPI schema.'));
        if (active) {
          setState({ phase: 'ready', crdName: crd.metadata.name, version: chosen?.name, root });
        }
      })
      .catch((err: Error & { status?: number }) => {
        if (!active) return;
        setState({
          phase: 'failed',
          message: err?.message || t('Failed to load the CRD.'),
          builtIn: err instanceof BuiltInKindError,
          forbidden: err?.status === 403,
        });
      });
    return () => {
      active = false;
    };
  }, [cluster, apiVersion, kind, attempt]);

  return { state, retry: () => setAttempt(n => n + 1) };
}

// ─── Presentation ───────────────────────────────────────────────────────────

const monospace = { fontFamily: 'monospace' };
const chipRow = { display: 'flex', flexWrap: 'wrap', gap: 1 } as const;
const clampTwoLines = {
  display: '-webkit-box',
  WebkitBoxOrient: 'vertical',
  WebkitLineClamp: 2,
  overflow: 'hidden',
} as const;

function Code({ children }: React.PropsWithChildren<unknown>) {
  return (
    <Typography variant="body2" component="div" sx={{ ...monospace, wordBreak: 'break-all' }}>
      {children}
    </Typography>
  );
}

function Section({ title, children }: React.PropsWithChildren<{ title: string }>) {
  return (
    <Box mt={2}>
      <Typography variant="body2" sx={{ fontWeight: 'bold', mb: 0.5 }}>
        {title}
      </Typography>
      {children}
    </Box>
  );
}

function DocsHeader({
  apiVersion,
  kind,
  state,
}: {
  apiVersion?: string;
  kind?: string;
  state: SchemaState;
}) {
  const intro = kindDoc(kind);
  const otherVersion =
    state.phase === 'ready' && state.version && !apiVersion?.endsWith(`/${state.version}`)
      ? state.version
      : undefined;
  return (
    <Box mb={3}>
      <Typography variant="h5" component="h2" sx={{ fontWeight: 'bold', mb: 1 }}>
        {kind || t('Documentation')}
      </Typography>
      <Typography variant="body2" color="text.secondary" mb={0.5}>
        {apiVersion}
        {apiVersion && otherVersion
          ? ` ${t('(schema of {{version}})', { version: otherVersion })}`
          : ''}
      </Typography>
      {state.phase === 'ready' && (
        <Typography variant="caption" component="div" color="text.secondary">
          {state.crdName}
        </Typography>
      )}
      {intro && (
        <Box mt={1.5}>
          <Typography variant="body2">{intro.summary}</Typography>
          {intro.url && (
            <Link variant="body2" href={intro.url} target="_blank" rel="noopener noreferrer">
              {t('Upstream documentation')}
            </Link>
          )}
        </Box>
      )}
    </Box>
  );
}

/** Everything the schema says about the field the user opened. */
function FieldDetails({
  name,
  node,
  required,
}: {
  name: string;
  node: SchemaNode;
  required: boolean;
}) {
  const limits = schemaLimits(node);
  const rules = node['x-kubernetes-validations'] ?? [];
  return (
    <Paper variant="outlined" sx={{ bgcolor: 'action.hover', p: 2, mb: 3 }}>
      <Box sx={{ ...chipRow, alignItems: 'center', mb: 1 }}>
        <Typography variant="h6" component="h3" sx={monospace}>
          {name}
        </Typography>
        <Chip size="small" color="primary" label={typeLabel(node)} />
        {node.format && <Chip size="small" variant="outlined" label={node.format} />}
        {required && <Chip size="small" color="error" label={t('required')} />}
      </Box>
      <Typography
        variant="body2"
        color={node.description ? undefined : 'text.secondary'}
        sx={{ whiteSpace: 'pre-wrap' }}
      >
        {node.description || t('The CRD has no description for this field.')}
      </Typography>
      {node.enum && node.enum.length > 0 && (
        <Section title={t('Allowed values:')}>
          <Box sx={chipRow}>
            {node.enum.map(option => (
              <Chip key={String(option)} size="small" variant="outlined" label={String(option)} />
            ))}
          </Box>
        </Section>
      )}
      {node.pattern && (
        <Section title={t('Pattern:')}>
          <Code>{node.pattern}</Code>
        </Section>
      )}
      {node.default !== undefined && (
        <Section title={t('Default:')}>
          <Code>{JSON.stringify(node.default)}</Code>
        </Section>
      )}
      {limits.length > 0 && (
        <Section title={t('Limits:')}>
          <Box sx={chipRow}>
            {limits.map(limit => (
              <Chip key={limit} size="small" variant="outlined" label={limit} />
            ))}
          </Box>
        </Section>
      )}
      {rules.length > 0 && (
        <Section title={t('Validation rules (CEL):')}>
          {rules.map((rule, i) => (
            <Box key={i} mb={1}>
              {rule.message && <Typography variant="body2">{rule.message}</Typography>}
              <Code>{rule.rule}</Code>
            </Box>
          ))}
        </Section>
      )}
    </Paper>
  );
}

/** One field in a list; opens the field (or, in search results, jumps to it). */
function FieldCard({
  name,
  node,
  required,
  isSet,
  location,
  onOpen,
}: {
  name: string;
  node: SchemaNode;
  required: boolean;
  isSet: boolean;
  /** Full path, shown for search results. */
  location?: string;
  onOpen: () => void;
}) {
  const opens = !!location || hasChildren(node);
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onOpen();
    }
  };
  return (
    <Paper
      variant="outlined"
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={onKeyDown}
      sx={{
        p: 2,
        cursor: 'pointer',
        transition: 'background-color 200ms, border-color 200ms',
        '&:hover, &:focus-visible': { borderColor: 'primary.main', bgcolor: 'action.hover' },
      }}
    >
      <Box sx={{ ...chipRow, alignItems: 'center', mb: node.description ? 1 : 0 }}>
        <Typography variant="body1" sx={{ ...monospace, fontWeight: 'bold' }}>
          {name}
        </Typography>
        <Chip size="small" variant="outlined" color="primary" label={typeLabel(node)} />
        {required && <Chip size="small" color="error" label={t('required')} />}
        {node.enum && node.enum.length > 0 && (
          <Chip
            size="small"
            variant="outlined"
            label={t('{{count}} values', { count: node.enum.length })}
          />
        )}
        {isSet && (
          <Tooltip title={t('Set in the current object')}>
            <Box component="span" sx={{ color: 'success.main', display: 'flex' }}>
              <Icon icon="mdi:check-circle" width={18} />
            </Box>
          </Tooltip>
        )}
        {opens && (
          <Box component="span" sx={{ display: 'flex', ml: 'auto' }}>
            <Icon icon="mdi:chevron-right" />
          </Box>
        )}
      </Box>
      {location && (
        <Typography variant="caption" color="text.secondary" display="block" sx={monospace}>
          {location}
        </Typography>
      )}
      {node.description && (
        <Typography variant="body2" color="text.secondary" sx={clampTwoLines}>
          {node.description}
        </Typography>
      )}
    </Paper>
  );
}

function FieldList({ heading, children }: React.PropsWithChildren<{ heading: string }>) {
  return (
    <Stack spacing={1}>
      <Typography variant="overline" color="text.secondary">
        {heading}
      </Typography>
      {children}
    </Stack>
  );
}

/** Back button and clickable path from the kind down to the opened field. */
function SchemaTrail({
  kind,
  path,
  onNavigate,
}: {
  kind?: string;
  path: string[];
  onNavigate: (path: string[]) => void;
}) {
  const crumbs = [kind || '', ...path];
  return (
    <Stack direction="row" alignItems="center" spacing={2} mb={3}>
      <IconButton
        size="small"
        aria-label={t('Back')}
        onClick={() => onNavigate(path.slice(0, -1))}
        sx={{ border: 1, borderColor: 'divider' }}
      >
        <Icon icon="mdi:arrow-left" />
      </IconButton>
      <Breadcrumbs separator="›">
        {crumbs.map((label, depth) => (
          <Link
            key={depth}
            component="button"
            variant="body2"
            underline="none"
            aria-current={depth === path.length ? 'location' : undefined}
            onClick={() => onNavigate(path.slice(0, depth))}
            sx={{ '&[aria-current]': { fontWeight: 'bold' } }}
          >
            {label}
          </Link>
        ))}
      </Breadcrumbs>
    </Stack>
  );
}

export interface CRDDocsViewerProps {
  apiVersion?: string;
  kind?: string;
  /** The object being edited, used to mark the fields that are set. */
  value?: unknown;
}

/** Renders the documentation for an already loaded (or failed) schema. */
export function CRDDocsView({
  apiVersion,
  kind,
  value,
  state,
  onRetry,
}: CRDDocsViewerProps & { state: SchemaState; onRetry?: () => void }) {
  const [path, setPath] = useState<string[]>([]);
  const [query, setQuery] = useState('');

  useEffect(() => {
    setPath([]);
    setQuery('');
  }, [apiVersion, kind]);

  const header = <DocsHeader apiVersion={apiVersion} kind={kind} state={state} />;
  const isSet = (fieldPath: string[]) => valueAtSchemaPath(value, fieldPath) !== undefined;

  if (state.phase === 'loading') {
    return (
      <Box p={3}>
        {header}
        <Stack alignItems="center" spacing={2} py={4}>
          <CircularProgress />
          <Typography variant="body2" color="text.secondary">
            {t('Loading the schema from the cluster…')}
          </Typography>
        </Stack>
      </Box>
    );
  }

  if (state.phase === 'failed') {
    return (
      <Box p={3}>
        {header}
        <Alert
          severity={state.builtIn ? 'info' : 'error'}
          action={
            state.builtIn || !onRetry ? undefined : (
              <Button
                size="small"
                color="inherit"
                onClick={onRetry}
                startIcon={<Icon icon="mdi:refresh" />}
              >
                {t('Retry')}
              </Button>
            )
          }
        >
          {state.forbidden
            ? t(
                'You are not allowed to read CustomResourceDefinitions, so the documentation is not available.'
              )
            : state.message}
        </Alert>
      </Box>
    );
  }

  const { root } = state;
  const opened = resolveSchemaPath(root, path);
  const fieldName = path[path.length - 1];
  const listed = path.length ? opened.container : root;
  const fields = Object.entries(listed?.properties ?? {});
  const requiredHere = listed?.required ?? [];
  const parent = path.length > 1 ? resolveSchemaPath(root, path.slice(0, -1)) : { container: root };
  const requiredInParent =
    childContainer(parent.node)?.required ?? parent.container?.required ?? [];
  const results = query ? findFields(root, query) : [];

  return (
    <Box sx={{ height: '100%', overflow: 'auto', p: 3 }}>
      {header}
      <Divider sx={{ mb: 2 }} />
      <TextField
        fullWidth
        size="small"
        placeholder={t('Search fields (name or description)…')}
        value={query}
        onChange={e => setQuery(e.target.value)}
        inputProps={{ 'aria-label': t('Search fields') }}
        InputProps={{
          startAdornment: (
            <InputAdornment position="start">
              <Icon icon="mdi:magnify" />
            </InputAdornment>
          ),
        }}
        sx={{ mb: 2 }}
      />

      {query ? (
        <FieldList
          heading={
            results.length
              ? t('{{count}} matching fields', { count: results.length })
              : t('No matching fields')
          }
        >
          {results.map(result => (
            <FieldCard
              key={result.path.join('.')}
              name={result.path[result.path.length - 1]}
              node={result.node}
              required={false}
              isSet={isSet(result.path)}
              location={result.path.join(' › ')}
              onOpen={() => {
                setQuery('');
                setPath(result.path);
              }}
            />
          ))}
        </FieldList>
      ) : (
        <>
          {path.length > 0 && <SchemaTrail kind={kind} path={path} onNavigate={setPath} />}
          {opened.node && (
            <FieldDetails
              name={fieldName}
              node={opened.node}
              required={requiredInParent.includes(fieldName)}
            />
          )}
          {fields.length > 0 ? (
            <FieldList heading={path.length ? t('Fields') : t('Top-level fields')}>
              {fields.map(([name, node]) => (
                <FieldCard
                  key={name}
                  name={name}
                  node={node}
                  required={requiredHere.includes(name)}
                  isSet={isSet([...path, name])}
                  onOpen={() => setPath([...path, name])}
                />
              ))}
            </FieldList>
          ) : (
            <Alert severity="info">{t('No sub-properties for this field.')}</Alert>
          )}
        </>
      )}
    </Box>
  );
}

/** Loads the CRD of `apiVersion`/`kind` from the current cluster and documents its fields. */
export function CRDDocsViewer({ apiVersion, kind, value }: CRDDocsViewerProps) {
  const { state, retry } = useCRDSchema(apiVersion, kind);
  return (
    <CRDDocsView apiVersion={apiVersion} kind={kind} value={value} state={state} onRetry={retry} />
  );
}
