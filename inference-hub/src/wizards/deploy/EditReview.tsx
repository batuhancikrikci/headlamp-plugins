import { Icon } from '@iconify/react';
import { SimpleTable } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Alert, Box, Button, Typography } from '@mui/material';
import React from 'react';
import { t } from '../../common/i18n';
import { toYaml, YamlEditorDialog } from '../../components/common/YamlEditorDialog';
import { KubeJson } from '../../resources/types';
import { DeployForm } from './deployModel';
import {
  applyFormToEndpoint,
  diffHunks,
  FormChange,
  formChanges,
  isStoppedObject,
  lineDiff,
  modelChangeError,
  restartsPods,
  writableCopy,
} from './editModel';

/** Changed lines of the YAML, with a few lines of context. */
function YamlDiff({ before, after }: { before: KubeJson; after: KubeJson }) {
  const hunks = React.useMemo(
    () => diffHunks(lineDiff(toYaml(before), toYaml(after))),
    [before, after]
  );
  if (hunks.length === 0) return null;
  return (
    <Box
      component="pre"
      aria-label={t('Changes to the YAML')}
      sx={{
        m: 0,
        p: 1.5,
        maxHeight: 360,
        overflow: 'auto',
        fontSize: 12,
        fontFamily: 'monospace',
        border: 1,
        borderColor: 'divider',
        borderRadius: 1,
      }}
    >
      {hunks.map((line, index) =>
        line === null ? (
          <Box key={index} component="div" sx={{ color: 'text.secondary' }}>
            …
          </Box>
        ) : (
          <Box
            key={index}
            component="div"
            sx={{
              whiteSpace: 'pre',
              color:
                line.kind === 'add'
                  ? 'success.main'
                  : line.kind === 'remove'
                  ? 'error.main'
                  : 'text.primary',
            }}
          >
            {line.kind === 'add' ? '+ ' : line.kind === 'remove' ? '- ' : '  '}
            {line.text}
          </Box>
        )
      )}
    </Box>
  );
}

/**
 * Review of the changes to an existing endpoint (wizard and form): what changes, what is kept, and the final
 * YAML, which is validated with a dry run and saved with the live object's resourceVersion.
 */
export function EditReview({
  live,
  original,
  form,
  notes,
  disabledReason,
  onSaved,
}: {
  live: KubeJson;
  original: DeployForm;
  form: DeployForm;
  notes: string[];
  disabledReason?: string;
  onSaved: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const before = React.useMemo(() => writableCopy(live), [live]);
  const after = React.useMemo(
    () => applyFormToEndpoint(live, original, form),
    [live, original, form]
  );
  const changes = formChanges(original, form);
  const unchanged = JSON.stringify(before) === JSON.stringify(after);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {unchanged ? (
        <Alert severity="info">{t('Nothing has changed yet.')}</Alert>
      ) : (
        <>
          <SimpleTable
            data={changes}
            columns={[
              { label: t('Setting'), getter: (c: FormChange) => t(c.label) },
              { label: t('Now'), getter: (c: FormChange) => c.from },
              { label: t('After saving'), getter: (c: FormChange) => c.to },
            ]}
          />
          {restartsPods(original, form) && (
            <Alert severity="warning">
              {t('Saving makes KServe replace the model server pods; the model loads again.')}
            </Alert>
          )}
          {isStoppedObject(live) && (
            <Alert severity="info">
              {t('The endpoint is stopped and stays stopped after saving.')}
            </Alert>
          )}
          <YamlDiff before={before} after={after} />
        </>
      )}
      {notes.length > 0 && (
        <Alert severity="info" icon={<Icon icon="mdi:lock-outline" />}>
          <Typography variant="body2" sx={{ mb: 0.5 }}>
            {t('Settings the form does not show are kept as they are:')}
          </Typography>
          <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
            {notes.map(note => (
              <li key={note}>
                <Typography variant="body2">{t(note)}</Typography>
              </li>
            ))}
          </Box>
        </Alert>
      )}
      <Box>
        <Button
          variant="contained"
          startIcon={<Icon icon="mdi:content-save-outline" />}
          disabled={unchanged || !!disabledReason}
          onClick={() => setOpen(true)}
        >
          {t('Review YAML and save')}
        </Button>
        {disabledReason && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {disabledReason}
          </Typography>
        )}
      </Box>
      <YamlEditorDialog
        open={open}
        mode="edit"
        title={t('Save {{name}}', { name: live.metadata.name })}
        description={t(
          'The YAML below is what will be saved. Validate it against the API server, then save. If the endpoint changed since you started editing, saving fails: open Edit again from the endpoint page.'
        )}
        initial={after}
        validate={obj => modelChangeError(live, obj)}
        onClose={() => setOpen(false)}
        onApplied={() => {
          setOpen(false);
          onSaved();
        }}
      />
    </Box>
  );
}
