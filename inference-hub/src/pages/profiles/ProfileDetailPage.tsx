import { Icon } from '@iconify/react';
import { Router } from '@kinvolk/headlamp-plugin/lib';
import {
  DateLabel,
  Link,
  NameValueTable,
  SectionBox,
  SimpleTable,
} from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Alert, Box, Button, Chip, Paper, Typography } from '@mui/material';
import React from 'react';
import { useHistory, useParams } from 'react-router-dom';
import { Discovery, locationsOf } from '../../api/discovery';
import { isNotFound } from '../../api/liveStore';
import { deleteObject } from '../../api/mutations';
import { customItemPath } from '../../api/paths';
import { t } from '../../common/i18n';
import { EmptyState, ErrorState, LoadingState } from '../../common/States';
import { ConfirmDialog } from '../../components/common/ConfirmDialog';
import { CopyableCode } from '../../components/common/CopyableCode';
import { DiscoveryGate } from '../../components/common/DiscoveryGate';
import { GuardedButton } from '../../components/common/GuardedButton';
import { ModelCell } from '../../components/common/ModelAvatar';
import { StatusBadge } from '../../components/common/StatusBadge';
import { toYaml, YamlEditorDialog } from '../../components/common/YamlEditorDialog';
import { useCurrentCluster } from '../../hooks/useCluster';
import { useEndpoints } from '../../hooks/useEndpoints';
import { useLivePath } from '../../hooks/useLive';
import { RESOURCES } from '../../resources/definitions';
import { ModelEndpoint } from '../../resources/endpoint';
import { endpointsUsingProfile, ProfileJson, summarizeProfile } from '../../resources/profile';
import { DETAIL_PAGES, PAGES } from '../../routes';
import { AspectChips } from './ProfilesPage';

function ProfileBody({
  discovery,
  namespace,
  name,
}: {
  discovery: Discovery;
  namespace: string;
  name: string;
}) {
  const cluster = useCurrentCluster();
  const history = useHistory();
  const location = locationsOf(discovery, 'llminferenceserviceconfigs')[0];
  const item = useLivePath<ProfileJson>(
    customItemPath(RESOURCES.llminferenceserviceconfigs, location, name, namespace)
  );
  const { endpoints } = useEndpoints();
  const [dialog, setDialog] = React.useState<'edit' | 'delete' | null>(null);

  if (item.loading) return <LoadingState title={t('Loading profile…')} />;
  if (isNotFound(item.error) || !item.data) {
    return (
      <SectionBox title={name}>
        {isNotFound(item.error) ? (
          <EmptyState
            icon="mdi:file-question-outline"
            title={t('Serving profile {{ns}}/{{name}} was not found', { ns: namespace, name })}
            action={
              <Button
                variant="outlined"
                startIcon={<Icon icon="mdi:arrow-left" />}
                onClick={() => history.push(Router.createRouteURL(PAGES.profiles.name))}
              >
                {t('All profiles')}
              </Button>
            }
          />
        ) : (
          <ErrorState error={item.error || t('Unknown error')} onRetry={item.refetch} />
        )}
      </SectionBox>
    );
  }

  const profile = item.data;
  const summary = summarizeProfile(profile);
  const users = endpointsUsingProfile(summary, endpoints);
  const access = (verb: 'update' | 'delete') => ({
    verb,
    group: location.group,
    resource: 'llminferenceserviceconfigs',
    namespace,
    name,
  });

  return (
    <Box>
      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
          <Box sx={{ color: 'primary.main', display: 'flex' }}>
            <Icon icon="mdi:tune-variant" width={44} />
          </Box>
          <Box sx={{ flexGrow: 1, minWidth: 240 }}>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
              <Typography variant="h5" component="h1">
                {name}
              </Typography>
              {summary.builtIn && (
                <Chip size="small" color="primary" variant="outlined" label={t('Built-in')} />
              )}
              <Chip
                size="small"
                variant="outlined"
                icon={<Icon icon="mdi:folder-outline" />}
                label={namespace}
              />
            </Box>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {t('Used by {{n}} LLM services', { n: users.length })}
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <GuardedButton
              check={access('update')}
              label={t('Edit YAML')}
              icon="mdi:pencil-outline"
              variant="outlined"
              onClick={() => setDialog('edit')}
            />
            <GuardedButton
              check={access('delete')}
              label={t('Delete')}
              icon="mdi:delete-outline"
              color="error"
              variant="outlined"
              onClick={() => setDialog('delete')}
            />
          </Box>
        </Box>
      </Paper>

      {summary.builtIn && (
        <Alert severity="info" sx={{ mb: 2 }}>
          {t(
            'This preset is installed with KServe. Local changes may be overwritten when KServe is upgraded; prefer a new profile that services reference in spec.baseRefs.'
          )}
        </Alert>
      )}

      <SectionBox title={t('Configuration')}>
        <NameValueTable
          rows={[
            { name: t('Description'), value: summary.description, hide: !summary.description },
            { name: t('Configures'), value: <AspectChips summary={summary} /> },
            { name: t('Image'), value: summary.image || '—' },
            {
              name: t('Extra vLLM arguments'),
              value: <CopyableCode code={summary.extraArgs || ''} />,
              hide: !summary.extraArgs,
            },
            {
              name: t('Created'),
              value: profile.metadata.creationTimestamp ? (
                <DateLabel date={profile.metadata.creationTimestamp} />
              ) : (
                '—'
              ),
            },
          ]}
        />
      </SectionBox>

      <SectionBox title={t('Used by')}>
        {users.length === 0 ? (
          <EmptyState
            dense
            icon="mdi:link-variant-off"
            title={t('No LLM service uses this profile')}
            description={t(
              'Reference it from an LLMInferenceService with spec.baseRefs: [{name: {{name}}}].',
              { name }
            )}
          />
        ) : (
          <SimpleTable
            data={users}
            columns={[
              {
                label: t('Service'),
                getter: (ep: ModelEndpoint) => (
                  <Link
                    routeName={DETAIL_PAGES.endpoint.name}
                    params={{ slug: ep.slug, namespace: ep.namespace, name: ep.name }}
                  >
                    {ep.namespace}/{ep.name}
                  </Link>
                ),
              },
              {
                label: t('Model'),
                getter: (ep: ModelEndpoint) => (
                  <ModelCell model={ep.model} servedName={ep.servedModelName} />
                ),
              },
              {
                label: t('Status'),
                getter: (ep: ModelEndpoint) => <StatusBadge summary={ep.status} />,
              },
            ]}
          />
        )}
      </SectionBox>

      <SectionBox title={t('Specification')}>
        <CopyableCode code={toYaml(profile.spec || {})} maxHeight={480} />
      </SectionBox>

      <YamlEditorDialog
        open={dialog === 'edit'}
        mode="edit"
        title={t('Edit {{name}}', { name })}
        initial={profile}
        onClose={() => setDialog(null)}
      />
      <ConfirmDialog
        open={dialog === 'delete'}
        danger
        title={t('Delete {{name}}?', { name })}
        message={
          users.length > 0
            ? t(
                '{{n}} LLM services reference this profile. They keep running, but their next reconciliation fails until the reference is removed.',
                { n: users.length }
              )
            : t('No LLM service uses this profile.')
        }
        typeToConfirm={users.length > 0 ? name : undefined}
        confirmLabel={t('Delete')}
        onConfirm={async () => {
          await deleteObject(profile, { cluster });
          history.push(Router.createRouteURL(PAGES.profiles.name));
        }}
        onClose={() => setDialog(null)}
      />
    </Box>
  );
}

export function ProfileDetailPage() {
  const { namespace, name } = useParams<{ namespace: string; name: string }>();
  return (
    <DiscoveryGate title={name} anyOf={['llminferenceserviceconfigs']}>
      {discovery => <ProfileBody discovery={discovery} namespace={namespace} name={name} />}
    </DiscoveryGate>
  );
}
