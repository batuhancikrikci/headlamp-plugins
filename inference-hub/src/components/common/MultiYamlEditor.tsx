import { Icon } from '@iconify/react';
import Editor from '@monaco-editor/react';
import { Alert, Box, Button, Chip, CircularProgress, Tab, Tabs, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import * as yaml from 'js-yaml';
import React from 'react';
import { createObject } from '../../api/mutations';
import { CRDDocsViewer } from '../../common/docs/CRDDocsViewer';
import { t } from '../../common/i18n';
import { useCurrentCluster } from '../../hooks/useCluster';
import { KubeJson } from '../../resources/types';
import { toYaml } from './YamlEditorDialog';

export function toMultiYaml(objects: KubeJson[]): string {
  return objects.map(toYaml).join('---\n');
}

/** Parses "---" separated Kubernetes objects; returns an error message for invalid input. */
export function parseMultiYaml(text: string): { objects: KubeJson[]; error?: string } {
  try {
    const docs = yaml.loadAll(text).filter(d => d !== null && d !== undefined);
    for (const [i, doc] of docs.entries()) {
      const obj = doc as KubeJson;
      if (typeof doc !== 'object' || Array.isArray(doc)) {
        return { objects: [], error: t('Document {{n}} is not an object.', { n: i + 1 }) };
      }
      if (!obj.apiVersion || !obj.kind || !obj.metadata?.name) {
        return {
          objects: [],
          error: t('Document {{n}} needs apiVersion, kind and metadata.name.', { n: i + 1 }),
        };
      }
    }
    if (docs.length === 0) return { objects: [], error: t('Nothing to create.') };
    return { objects: docs as KubeJson[] };
  } catch (err) {
    return { objects: [], error: (err as Error).message };
  }
}

type Outcome = { ok: boolean; lines: string[] };

/**
 * Editable YAML of the objects to create, with a server-side dry run and sequential creation.
 * Every create flow ends here so the user always sees the final YAML.
 */
export function MultiYamlEditor({
  objects,
  submitLabel,
  onCreated,
  disabledReason,
}: {
  objects: KubeJson[];
  submitLabel: string;
  onCreated: (created: KubeJson[]) => void;
  /** Blocks creation (e.g. missing permission). */
  disabledReason?: string;
}) {
  const theme = useTheme();
  const cluster = useCurrentCluster();
  const initial = React.useMemo(() => toMultiYaml(objects), [objects]);
  const [text, setText] = React.useState(initial);
  const [busy, setBusy] = React.useState<'validate' | 'create' | null>(null);
  const [outcome, setOutcome] = React.useState<Outcome | null>(null);
  const [tab, setTab] = React.useState<'yaml' | 'docs'>('yaml');
  const [selected, setSelected] = React.useState(0);
  const edited = text !== initial;

  React.useEffect(() => {
    setText(initial);
    setOutcome(null);
  }, [initial]);

  const parsed = React.useMemo(() => parseMultiYaml(text), [text]);
  // While the YAML is invalid, the documentation keeps showing the generated objects.
  const documentedObjects = parsed.objects.length ? parsed.objects : objects;
  // The last object is the main one (e.g. the endpoint after its catalog entry).
  const docIndex = Math.min(selected, documentedObjects.length - 1);
  const documented = documentedObjects[docIndex < 0 ? 0 : docIndex];

  React.useEffect(() => setSelected(Math.max(0, objects.length - 1)), [objects.length]);

  const run = async (dryRun: boolean) => {
    setBusy(dryRun ? 'validate' : 'create');
    setOutcome(null);
    const lines: string[] = [];
    const created: KubeJson[] = [];
    try {
      for (const obj of parsed.objects) {
        const saved = await createObject(obj, { cluster, dryRun });
        created.push(saved);
        lines.push(
          dryRun
            ? t('{{kind}} {{name}}: accepted', { kind: obj.kind, name: obj.metadata.name })
            : t('{{kind}} {{name}}: created', { kind: obj.kind, name: obj.metadata.name })
        );
      }
      setOutcome({ ok: true, lines });
      if (!dryRun) onCreated(created);
    } catch (err) {
      const e = err as { message?: string; status?: number };
      const failed = parsed.objects[created.length];
      lines.push(
        `${failed?.kind} ${failed?.metadata.name}: ${e.message || String(err)}${
          e.status === 409 ? ` ${t('(an object with this name already exists)')}` : ''
        }`
      );
      if (!dryRun && created.length > 0) {
        lines.push(t('Objects created before the error were kept.'));
      }
      setOutcome({ ok: false, lines });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Box>
      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 1 }}>
        <Tabs value={tab} onChange={(_, v) => setTab(v)} aria-label={t('Editor mode')}>
          <Tab
            value="yaml"
            label="YAML"
            icon={<Icon icon="mdi:code-braces" />}
            iconPosition="start"
          />
          <Tab
            value="docs"
            label={t('Documentation')}
            icon={<Icon icon="mdi:book-open-variant" />}
            iconPosition="start"
          />
        </Tabs>
      </Box>
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mb: 1, flexWrap: 'wrap' }}>
        {documentedObjects.map((o, i) => (
          <Chip
            key={i}
            size="small"
            variant={tab === 'docs' && i === docIndex ? 'filled' : 'outlined'}
            color={tab === 'docs' && i === docIndex ? 'primary' : 'default'}
            label={`${o.kind} ${o.metadata.name}`}
            onClick={
              documentedObjects.length > 1
                ? () => {
                    setSelected(i);
                    setTab('docs');
                  }
                : undefined
            }
          />
        ))}
        {edited && (
          <Button
            size="small"
            onClick={() => setText(initial)}
            startIcon={<Icon icon="mdi:undo" />}
          >
            {t('Discard YAML edits')}
          </Button>
        )}
      </Box>
      {tab === 'docs' && documented && (
        <Box sx={{ height: 420, border: 1, borderColor: 'divider', overflow: 'auto' }}>
          <CRDDocsViewer
            apiVersion={documented.apiVersion}
            kind={documented.kind}
            value={documented}
          />
        </Box>
      )}
      <Box
        sx={{
          height: 420,
          border: 1,
          borderColor: 'divider',
          display: tab === 'yaml' ? 'block' : 'none',
        }}
      >
        <Editor
          language="yaml"
          value={text}
          onChange={v => setText(v ?? '')}
          theme={theme.palette.mode === 'dark' ? 'vs-dark' : 'light'}
          options={{
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            fontSize: 13,
            tabSize: 2,
            automaticLayout: true,
          }}
        />
      </Box>
      {edited && (
        <Typography variant="caption" color="text.secondary">
          {t(
            'You edited the YAML. Changing an earlier step regenerates it and discards these edits.'
          )}
        </Typography>
      )}
      {parsed.error && (
        <Alert severity="warning" sx={{ mt: 1 }}>
          {parsed.error}
        </Alert>
      )}
      {outcome && (
        <Alert severity={outcome.ok ? 'success' : 'error'} sx={{ mt: 1 }}>
          {outcome.lines.map((l, i) => (
            <div key={i}>{l}</div>
          ))}
        </Alert>
      )}
      {disabledReason && (
        <Alert severity="error" sx={{ mt: 1 }}>
          {disabledReason}
        </Alert>
      )}
      <Box sx={{ display: 'flex', gap: 1, mt: 2, justifyContent: 'flex-end' }}>
        <Button
          variant="outlined"
          onClick={() => run(true)}
          disabled={!!busy || !!parsed.error}
          startIcon={
            busy === 'validate' ? (
              <CircularProgress size={16} />
            ) : (
              <Icon icon="mdi:check-decagram-outline" />
            )
          }
        >
          {t('Validate')}
        </Button>
        <Button
          variant="contained"
          onClick={() => run(false)}
          disabled={!!busy || !!parsed.error || !!disabledReason}
          startIcon={
            busy === 'create' ? (
              <CircularProgress size={16} color="inherit" />
            ) : (
              <Icon icon="mdi:rocket-launch-outline" />
            )
          }
        >
          {submitLabel}
        </Button>
      </Box>
    </Box>
  );
}
