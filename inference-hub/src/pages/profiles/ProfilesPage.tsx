import { Icon } from '@iconify/react';
import {
  DateLabel,
  Link,
  SectionBox,
  SectionFilterHeader,
  Table,
} from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { useFilterFunc } from '@kinvolk/headlamp-plugin/lib/Utils';
import { Alert, Box, Chip, Tooltip, Typography } from '@mui/material';
import React from 'react';
import { DocsDrawer } from '../../common/docs/DocsDrawer';
import { t } from '../../common/i18n';
import { ForbiddenState } from '../../common/States';
import { DiscoveryGate } from '../../components/common/DiscoveryGate';
import { GuardedButton } from '../../components/common/GuardedButton';
import { YamlEditorDialog } from '../../components/common/YamlEditorDialog';
import { useDefaultNamespace, useEndpoints } from '../../hooks/useEndpoints';
import { useResourceList } from '../../hooks/useLive';
import { RESOURCES } from '../../resources/definitions';
import {
  endpointsUsingProfile,
  ProfileJson,
  ProfileSummary,
  summarizeProfile,
} from '../../resources/profile';
import { llmInferenceServiceConfigTemplate } from '../../resources/templates';
import { DETAIL_PAGES } from '../../routes';
import { ProfileFormDialog } from '../../wizards/profile/ProfileFormDialog';

interface Row {
  summary: ProfileSummary;
  raw: ProfileJson;
  usedBy: number;
}

export function AspectChips({ summary, max }: { summary: ProfileSummary; max?: number }) {
  const shown = max ? summary.aspects.slice(0, max) : summary.aspects;
  const rest = summary.aspects.length - shown.length;
  return (
    <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
      {shown.map(a => (
        <Chip
          key={a.id}
          size="small"
          variant="outlined"
          icon={<Icon icon={a.icon} />}
          label={t(a.label)}
        />
      ))}
      {rest > 0 && (
        <Tooltip
          title={summary.aspects
            .slice(shown.length)
            .map(a => a.label)
            .join(', ')}
        >
          <Chip size="small" label={`+${rest}`} />
        </Tooltip>
      )}
    </Box>
  );
}

function ProfilesTable() {
  const profiles = useResourceList<ProfileJson>('llminferenceserviceconfigs');
  const { endpoints } = useEndpoints();
  const namespace = useDefaultNamespace();
  const filterFunc = useFilterFunc<ProfileJson>();
  const [creating, setCreating] = React.useState<'form' | 'yaml' | null>(null);
  const location = profiles.locations[0];
  const createCheck = location
    ? {
        verb: 'create' as const,
        group: location.group,
        resource: 'llminferenceserviceconfigs',
        namespace,
      }
    : null;

  const rows: Row[] = React.useMemo(
    () =>
      profiles.items
        .filter(p => filterFunc(p))
        .map(raw => {
          const summary = summarizeProfile(raw);
          return { raw, summary, usedBy: endpointsUsingProfile(summary, endpoints).length };
        }),
    [profiles.items, endpoints, filterFunc]
  );

  return (
    <SectionBox
      title={
        <SectionFilterHeader
          title={t('Serving Profiles')}
          actions={[
            <DocsDrawer
              key="docs"
              iconOnly
              apiVersion={location?.apiVersion}
              kind={location ? RESOURCES.llminferenceserviceconfigs.kind : undefined}
            />,
            <GuardedButton
              key="create"
              variant="contained"
              check={createCheck}
              label={t('New profile')}
              icon="mdi:plus"
              onClick={() => setCreating('form')}
            />,
            <GuardedButton
              key="yaml"
              variant="outlined"
              check={createCheck}
              label={t('From YAML')}
              icon="mdi:code-braces"
              onClick={() => setCreating('yaml')}
            />,
          ]}
        />
      }
    >
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t(
          'Reusable configuration for LLM services: model server image and arguments, prefill/decode layout, scheduler and routing. Services reference profiles in spec.baseRefs; KServe also applies its built-in presets automatically.'
        )}
      </Typography>
      {profiles.forbidden ? (
        <ForbiddenState what={t('serving profiles')} />
      ) : (
        <>
          {profiles.errors.length > 0 && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              {profiles.errors.map(e => e.message).join('; ')}
            </Alert>
          )}
          <Table<Row>
            data={rows}
            loading={profiles.loading && rows.length === 0}
            getRowId={r => `${r.summary.namespace}/${r.summary.name}`}
            emptyMessage={t('No serving profiles found.')}
            columns={[
              {
                id: 'name',
                header: t('Name'),
                accessorFn: r => r.summary.name,
                Cell: ({ row }) => (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Link
                      routeName={DETAIL_PAGES.profile.name}
                      params={{
                        namespace: row.original.summary.namespace,
                        name: row.original.summary.name,
                      }}
                    >
                      {row.original.summary.name}
                    </Link>
                    {row.original.summary.builtIn && (
                      <Tooltip title={t('Shipped with KServe')}>
                        <Chip
                          size="small"
                          color="primary"
                          variant="outlined"
                          label={t('Built-in')}
                        />
                      </Tooltip>
                    )}
                  </Box>
                ),
              },
              { id: 'namespace', header: t('Namespace'), accessorFn: r => r.summary.namespace },
              {
                id: 'configures',
                header: t('Configures'),
                accessorFn: r => r.summary.aspects.map(a => a.label).join(' '),
                gridTemplate: 'minmax(260px, 2fr)',
                Cell: ({ row }) => <AspectChips summary={row.original.summary} max={4} />,
              },
              {
                id: 'image',
                header: t('Image'),
                accessorFn: r => r.summary.image || '',
                Cell: ({ row }) => (
                  <Typography
                    variant="body2"
                    noWrap
                    sx={{ maxWidth: 260, fontFamily: 'monospace' }}
                  >
                    {row.original.summary.image?.split('/').pop() || '—'}
                  </Typography>
                ),
              },
              { id: 'usedBy', header: t('Used by'), accessorFn: r => r.usedBy },
              {
                id: 'age',
                header: t('Age'),
                accessorFn: r => r.raw.metadata.creationTimestamp || '',
                Cell: ({ row }) =>
                  row.original.raw.metadata.creationTimestamp ? (
                    <DateLabel date={row.original.raw.metadata.creationTimestamp} format="mini" />
                  ) : (
                    '—'
                  ),
              },
            ]}
          />
        </>
      )}
      {creating === 'form' && location && (
        <ProfileFormDialog
          open
          apiVersion={location.apiVersion}
          onClose={() => setCreating(null)}
        />
      )}
      {creating === 'yaml' && location && (
        <YamlEditorDialog
          open
          mode="create"
          title={t('New serving profile')}
          description={t(
            'Any LLMInferenceService field can be set here; services listing this profile in spec.baseRefs inherit it.'
          )}
          initial={llmInferenceServiceConfigTemplate(location.apiVersion, namespace)}
          onClose={() => setCreating(null)}
        />
      )}
    </SectionBox>
  );
}

export function ProfilesPage() {
  return (
    <DiscoveryGate title={t('Serving Profiles')} anyOf={['llminferenceserviceconfigs']}>
      <ProfilesTable />
    </DiscoveryGate>
  );
}
