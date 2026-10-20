import { Icon } from '@iconify/react';
import { Link, SectionBox } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import {
  Alert,
  Box,
  Button,
  Card,
  CardActions,
  CardContent,
  Chip,
  Grid,
  MenuItem,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import React from 'react';
import { useHistory } from 'react-router-dom';
import { DocsDrawer } from '../../common/docs/DocsDrawer';
import { t } from '../../common/i18n';
import { EmptyState, ErrorState, ForbiddenState, LoadingState } from '../../common/States';
import { DiscoveryGate } from '../../components/common/DiscoveryGate';
import { GuardedButton } from '../../components/common/GuardedButton';
import { ModelAvatar, ModelTraits } from '../../components/common/ModelAvatar';
import { StatusBadge } from '../../components/common/StatusBadge';
import { SummaryTiles } from '../../components/common/SummaryTiles';
import { UsageBar } from '../../components/common/UsageBar';
import { useCatalog } from '../../hooks/useCatalog';
import { CatalogEntry, matchesQuery } from '../../resources/catalog';
import { RESOURCES } from '../../resources/definitions';
import { deployUrl, DETAIL_PAGES } from '../../routes';
import { formatParams, SCHEME_INFO } from '../../utils/modelInfo';
import { formatBytes } from '../../utils/quantity';
import { AddModelDialog } from '../../wizards/catalog/AddModelDialog';

type StateFilter = 'all' | 'ready' | 'progressing' | 'failed';
type Sort = 'name' | 'size' | 'recent' | 'usage';

function CatalogCard({ entry }: { entry: CatalogEntry }) {
  const history = useHistory();
  const { model } = entry;
  const scheme = SCHEME_INFO[model.scheme];
  return (
    <Card variant="outlined" sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <CardContent sx={{ flexGrow: 1, pb: 1 }}>
        <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start' }}>
          <ModelAvatar model={model} size={44} />
          <Box sx={{ minWidth: 0, flexGrow: 1 }}>
            <Link routeName={DETAIL_PAGES.catalogEntry.name} params={{ name: entry.name }}>
              <Typography
                variant="subtitle1"
                sx={{ fontWeight: 600, lineHeight: 1.3 }}
                noWrap
                title={entry.displayName}
              >
                {entry.displayName}
              </Typography>
            </Link>
            <Typography variant="body2" color="text.secondary" noWrap>
              {[model.provider?.label, model.family, formatParams(model.paramsB)]
                .filter(Boolean)
                .join(' · ') || entry.name}
            </Typography>
          </Box>
        </Box>
        <Box sx={{ mt: 1.5, display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
          <ModelTraits model={model} />
          {entry.tags.map(tag => (
            <Chip
              key={tag}
              size="small"
              variant="outlined"
              label={tag}
              sx={{ height: 20, fontSize: '0.7rem' }}
            />
          ))}
        </Box>
        {entry.description && (
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{
              mt: 1.5,
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {entry.description}
          </Typography>
        )}
        <Box
          sx={{
            mt: 1.5,
            display: 'flex',
            alignItems: 'center',
            gap: 0.75,
            color: 'text.secondary',
          }}
        >
          <Icon icon={scheme.icon} width={14} />
          <Tooltip title={entry.uri}>
            <Typography variant="caption" noWrap sx={{ fontFamily: 'monospace' }}>
              {entry.uri}
            </Typography>
          </Tooltip>
        </Box>
        <Box
          sx={{
            mt: 1.5,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 1,
            flexWrap: 'wrap',
          }}
        >
          <UsageBar
            used={entry.copies.available}
            total={Math.max(entry.copies.total, 1)}
            width={80}
            label={t('{{a}}/{{t}} nodes', { a: entry.copies.available, t: entry.copies.total })}
            tooltip={t('Cached copies ready on the nodes of {{g}}', {
              g: entry.nodeGroups.join(', '),
            })}
          />
          <StatusBadge
            summary={entry.health}
            label={entry.health.health === 'ready' ? t('Cached') : undefined}
          />
        </Box>
      </CardContent>
      <CardActions sx={{ px: 2, pb: 1.5, justifyContent: 'space-between' }}>
        <Typography variant="caption" color="text.secondary">
          {[
            entry.modelSize,
            entry.users.length
              ? t('{{n}} endpoint(s)', { n: entry.users.length })
              : t('Not deployed'),
          ]
            .filter(Boolean)
            .join(' · ')}
        </Typography>
        <Button
          size="small"
          variant="contained"
          startIcon={<Icon icon="mdi:rocket-launch-outline" />}
          onClick={() => history.push(deployUrl({ cache: entry.name, uri: entry.uri }))}
        >
          {t('Deploy')}
        </Button>
      </CardActions>
    </Card>
  );
}

function Catalog() {
  const catalog = useCatalog();
  const [query, setQuery] = React.useState('');
  const [provider, setProvider] = React.useState('');
  const [state, setState] = React.useState<StateFilter>('all');
  const [sort, setSort] = React.useState<Sort>('name');
  const [adding, setAdding] = React.useState(false);
  const location = catalog.locations[0];
  const entries = catalog.entries;

  const providers = Array.from(
    new Set(entries.map(e => e.model.provider?.label).filter(Boolean))
  ) as string[];
  const visible = entries
    .filter(e => matchesQuery(e, query))
    .filter(e => !provider || e.model.provider?.label === provider)
    .filter(e => state === 'all' || e.health.health === state)
    .sort((a, b) => {
      switch (sort) {
        case 'size':
          return (b.sizeBytes || 0) - (a.sizeBytes || 0);
        case 'recent':
          return (b.createdAt || '').localeCompare(a.createdAt || '');
        case 'usage':
          return b.users.length - a.users.length;
        default:
          return a.displayName.localeCompare(b.displayName);
      }
    });
  const cachedBytes = entries.reduce((s, e) => s + (e.sizeBytes || 0) * e.copies.available, 0);

  let body: React.ReactNode;
  if (catalog.forbidden) body = <ForbiddenState what={t('LocalModelCache objects')} />;
  else if (catalog.loading && entries.length === 0)
    body = <LoadingState title={t('Loading the catalog…')} />;
  else if (catalog.errors.length && entries.length === 0)
    body = <ErrorState error={catalog.errors[0]} onRetry={catalog.refetch} />;
  else if (entries.length === 0) {
    body = (
      <EmptyState
        icon="mdi:bookshelf"
        title={t('The catalog is empty')}
        description={t(
          'Add the models your teams may deploy. Each entry is a KServe LocalModelCache, so the weights are pre-downloaded to your GPU nodes and endpoints start faster.'
        )}
        action={
          <Button
            variant="contained"
            startIcon={<Icon icon="mdi:plus" />}
            onClick={() => setAdding(true)}
          >
            {t('Add model')}
          </Button>
        }
      />
    );
  } else {
    body = (
      <>
        <SummaryTiles
          tiles={[
            {
              id: 'models',
              label: t('Models'),
              value: entries.length,
              icon: 'mdi:bookshelf',
              color: 'primary.main',
            },
            {
              id: 'cached',
              label: t('Fully cached'),
              value: entries.filter(e => e.health.health === 'ready').length,
              icon: 'mdi:database-check-outline',
              color: 'success.main',
            },
            {
              id: 'failed',
              label: t('Download errors'),
              value: entries.filter(e => e.health.health === 'failed').length,
              icon: 'mdi:alert-circle-outline',
              color: 'error.main',
            },
            {
              id: 'deployed',
              label: t('In use'),
              value: entries.filter(e => e.users.length > 0).length,
              icon: 'mdi:rocket-launch-outline',
              color: 'info.main',
            },
            {
              id: 'disk',
              label: t('Cached on disk'),
              value: formatBytes(cachedBytes, 0),
              icon: 'mdi:harddisk',
              color: 'text.secondary',
            },
          ]}
        />
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center', mb: 2 }}>
          <TextField
            size="small"
            placeholder={t('Search models, providers, tags')}
            value={query}
            onChange={e => setQuery(e.target.value)}
            sx={{ minWidth: 260, flexGrow: 1 }}
            InputProps={{ startAdornment: <Icon icon="mdi:magnify" style={{ marginRight: 8 }} /> }}
          />
          <ToggleButtonGroup
            size="small"
            exclusive
            value={state}
            onChange={(_, v) => v && setState(v)}
          >
            <ToggleButton value="all">{t('All')}</ToggleButton>
            <ToggleButton value="ready">{t('Cached')}</ToggleButton>
            <ToggleButton value="progressing">{t('Downloading')}</ToggleButton>
            <ToggleButton value="failed">{t('Failed')}</ToggleButton>
          </ToggleButtonGroup>
          <TextField
            select
            size="small"
            label={t('Sort')}
            value={sort}
            onChange={e => setSort(e.target.value as Sort)}
            sx={{ minWidth: 150 }}
          >
            <MenuItem value="name">{t('Name')}</MenuItem>
            <MenuItem value="size">{t('Size')}</MenuItem>
            <MenuItem value="recent">{t('Recently added')}</MenuItem>
            <MenuItem value="usage">{t('Most used')}</MenuItem>
          </TextField>
        </Box>
        {providers.length > 1 && (
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 2 }}>
            <Chip
              label={t('All providers')}
              color={provider ? 'default' : 'primary'}
              onClick={() => setProvider('')}
            />
            {providers.map(p => {
              const icon = entries.find(e => e.model.provider?.label === p)?.model.provider?.icon;
              return (
                <Chip
                  key={p}
                  icon={icon ? <Icon icon={icon} /> : undefined}
                  label={p}
                  color={provider === p ? 'primary' : 'default'}
                  variant={provider === p ? 'filled' : 'outlined'}
                  onClick={() => setProvider(provider === p ? '' : p)}
                />
              );
            })}
          </Box>
        )}
        {catalog.errors.length > 0 && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            {catalog.errors.map(e => e.message).join('; ')}
          </Alert>
        )}
        {visible.length === 0 ? (
          <EmptyState
            dense
            icon="mdi:filter-remove-outline"
            title={t('No model matches the filters')}
          />
        ) : (
          <Grid container spacing={2}>
            {visible.map(entry => (
              <Grid item xs={12} sm={6} lg={4} xl={3} key={entry.name}>
                <CatalogCard entry={entry} />
              </Grid>
            ))}
          </Grid>
        )}
      </>
    );
  }

  return (
    <SectionBox
      title={t('Model Catalog')}
      headerProps={{
        titleSideActions: [
          <DocsDrawer
            key="docs"
            iconOnly
            apiVersion={location?.apiVersion}
            kind={location ? RESOURCES.localmodelcaches.kind : undefined}
          />,
          <GuardedButton
            key="add"
            variant="contained"
            check={
              location
                ? { verb: 'create', group: location.group, resource: 'localmodelcaches' }
                : null
            }
            label={t('Add model')}
            icon="mdi:plus"
            onClick={() => setAdding(true)}
          />,
        ],
      }}
    >
      {body}
      {adding && location && (
        <AddModelDialog
          open
          apiVersion={location.apiVersion}
          existingNames={entries.map(e => e.name)}
          onClose={() => setAdding(false)}
        />
      )}
    </SectionBox>
  );
}

export function CatalogPage() {
  return (
    <DiscoveryGate title={t('Model Catalog')} anyOf={['localmodelcaches']}>
      <Catalog />
    </DiscoveryGate>
  );
}
