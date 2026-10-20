import { Icon } from '@iconify/react';
import {
  Alert,
  Autocomplete,
  Box,
  Chip,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import React from 'react';
import { useText } from '../../common/i18n';
import { useEndpointSubjects, useWorkloads } from '../../hooks/useClusterData';
import { PolicyRule } from '../../resources/networkPolicy';
import { LabelSelector } from '../../resources/types';
import { ruleSelectsSubject } from '../../utils/policyMatch';
import { isSelectorEmpty } from '../../utils/selectors';
import {
  labelOptions,
  Workload,
  workloadForSelector,
  workloadKey,
  workloadSelector,
} from '../../utils/workloads';
import { LabelSelectorEditor } from '../common/form/SelectorEditor';
import { SelectorView } from '../common/Shared';

type TargetMode = 'workload' | 'all' | 'custom';

const KIND_ICONS: Record<string, string> = {
  Deployment: 'mdi:layers-triple-outline',
  StatefulSet: 'mdi:database-outline',
  DaemonSet: 'mdi:server-network',
};

/** Which endpoints the selector currently matches. */
function MatchingEndpoints({
  selector,
  namespace,
}: {
  selector: LabelSelector;
  namespace?: string;
}) {
  const { t } = useText();
  const endpoints = useEndpointSubjects(namespace);
  if (endpoints.error && !endpoints.items) return null;
  const rule: PolicyRule = { endpointSelector: selector };
  const matched = (endpoints.items || []).filter(e =>
    ruleSelectsSubject(rule, namespace, e.subject)
  );
  return (
    <Alert
      sx={{ mt: 2 }}
      severity={endpoints.items && matched.length === 0 ? 'warning' : 'info'}
      icon={<Icon icon="mdi:target" />}
    >
      {endpoints.items === null
        ? t('Looking up matching endpoints…')
        : matched.length === 0
        ? t('No running pod currently matches. The policy applies as soon as matching pods start.')
        : t('{{count}} pod(s) will be protected: {{names}}', {
            count: matched.length,
            names:
              matched
                .slice(0, 6)
                .map(e => e.endpoint.metadata.name)
                .join(', ') + (matched.length > 6 ? '…' : ''),
          })}
    </Alert>
  );
}

const MAX_LABEL_CHIPS = 80;

/**
 * Labels that exist on the pods in scope, offered as one-click choices for a hand-written
 * selector. Clicking a label adds it to (or removes it from) the selector's matchLabels.
 */
function AvailableLabels({
  selector,
  onChange,
  namespace,
}: {
  selector: LabelSelector;
  onChange: (selector: LabelSelector) => void;
  namespace?: string;
}) {
  const { t } = useText();
  const endpoints = useEndpointSubjects(namespace);
  const [filter, setFilter] = React.useState('');
  const options = React.useMemo(
    () => labelOptions((endpoints.items || []).map(e => e.subject.labels)),
    [endpoints.items]
  );
  const selected = selector.matchLabels || {};
  const query = filter.trim().toLowerCase();
  const visible = options.filter(
    o => !query || `${o.key}=${o.value}`.toLowerCase().includes(query)
  );

  const toggle = (key: string, value: string) => {
    const labels = { ...selected };
    if (labels[key] === value) delete labels[key];
    else labels[key] = value;
    onChange({ ...selector, matchLabels: labels });
  };

  if (endpoints.items === null) {
    return endpoints.error ? null : (
      <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
        {t('Loading the labels of running pods…')}
      </Typography>
    );
  }
  if (options.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
        {namespace
          ? t('No pod labels found in namespace {{namespace}}.', { namespace })
          : t('No pod labels found.')}
      </Typography>
    );
  }
  return (
    <Box sx={{ mt: 2.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1, flexWrap: 'wrap' }}>
        <Box sx={{ flexGrow: 1 }}>
          <Typography variant="subtitle2">{t('Available labels')}</Typography>
          <Typography variant="caption" color="text.secondary">
            {namespace
              ? t('Labels of the pods in namespace {{namespace}}. Click to add or remove.', {
                  namespace,
                })
              : t('Labels of the pods in the cluster. Click to add or remove.')}
          </Typography>
        </Box>
        {options.length > 12 && (
          <TextField
            size="small"
            label={t('Filter labels')}
            value={filter}
            onChange={e => setFilter(e.target.value)}
            sx={{ width: 220 }}
          />
        )}
      </Box>
      <Box
        // Keyboard users must be able to scroll the region.
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
        tabIndex={0}
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 0.75,
          maxHeight: 168,
          overflowY: 'auto',
          p: 1,
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 1,
        }}
      >
        {visible.slice(0, MAX_LABEL_CHIPS).map(option => {
          const active = selected[option.key] === option.value;
          return (
            <Chip
              key={`${option.key}=${option.value}`}
              size="small"
              variant={active ? 'filled' : 'outlined'}
              color={active ? 'primary' : 'default'}
              icon={active ? <Icon icon="mdi:check" width={14} /> : undefined}
              label={`${option.key}=${option.value} · ${option.count}`}
              title={t('{{count}} pod(s) carry this label', { count: option.count })}
              aria-pressed={active}
              sx={{ fontFamily: 'monospace' }}
              onClick={() => toggle(option.key, option.value)}
            />
          );
        })}
        {visible.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            {t('No label matches the filter.')}
          </Typography>
        )}
        {visible.length > MAX_LABEL_CHIPS && (
          <Typography variant="caption" color="text.secondary" sx={{ alignSelf: 'center' }}>
            {t('+{{count}} more; use the filter to narrow down', {
              count: visible.length - MAX_LABEL_CHIPS,
            })}
          </Typography>
        )}
      </Box>
    </Box>
  );
}

/**
 * Target step of the network policy wizard: the user picks a workload and the endpoint selector
 * is derived from that workload's pod selector. Selecting every endpoint, or writing the labels
 * by hand, remain available as alternatives.
 */
export function WorkloadTarget({
  selector,
  onChange,
  namespace,
  clusterwide,
}: {
  selector: LabelSelector;
  onChange: (selector: LabelSelector) => void;
  /** Namespace of a namespaced policy; undefined for clusterwide policies. */
  namespace?: string;
  clusterwide: boolean;
}) {
  const { t } = useText();
  const workloads = useWorkloads(namespace);
  const items = workloads.items || [];
  const selected = workloadForSelector(selector, items, clusterwide);
  const [mode, setMode] = React.useState<TargetMode>(() =>
    isSelectorEmpty(selector) ? 'workload' : 'custom'
  );
  // A selector that matches a workload (for example when the wizard is reopened) is shown as
  // that workload once the list has loaded.
  React.useEffect(() => {
    if (selected && mode === 'custom') setMode('workload');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!selected]);

  const selectMode = (next: TargetMode | null) => {
    if (!next || next === mode) return;
    setMode(next);
    // Leaving the workload or custom mode for "all" clears the labels; the other switches
    // keep them so that a workload's labels can be fine-tuned by hand.
    if (next === 'all' || (next === 'workload' && !selected)) onChange({ matchLabels: {} });
  };
  const empty = isSelectorEmpty(selector);

  return (
    <Box>
      <Typography variant="subtitle2" sx={{ mb: 1 }}>
        {t('Protected workload')}
      </Typography>
      <ToggleButtonGroup
        exclusive
        size="small"
        value={mode}
        onChange={(_, v) => selectMode(v)}
        aria-label={t('How to choose the protected pods')}
        sx={{ mb: 2 }}
      >
        <ToggleButton value="workload">{t('A workload')}</ToggleButton>
        <ToggleButton value="all">
          {clusterwide ? t('All pods in the cluster') : t('All pods in the namespace')}
        </ToggleButton>
        <ToggleButton value="custom">{t('Custom labels')}</ToggleButton>
      </ToggleButtonGroup>

      {mode === 'workload' && (
        <>
          <Autocomplete<Workload>
            size="small"
            options={items}
            loading={workloads.items === null && !workloads.error}
            value={selected || null}
            onChange={(_, workload) =>
              onChange(workload ? workloadSelector(workload, clusterwide) : { matchLabels: {} })
            }
            isOptionEqualToValue={(a, b) => workloadKey(a) === workloadKey(b)}
            getOptionLabel={workload =>
              clusterwide ? `${workload.namespace}/${workload.name}` : workload.name
            }
            groupBy={clusterwide ? workload => workload.namespace : undefined}
            noOptionsText={
              workloads.error
                ? t('Workloads could not be listed')
                : namespace
                ? t('No workloads in namespace {{namespace}}', { namespace })
                : t('No workloads found')
            }
            renderOption={(props, workload) => (
              <Box component="li" {...props} key={workloadKey(workload)}>
                <Box sx={{ color: 'text.secondary', display: 'flex', mr: 1.5 }}>
                  <Icon icon={KIND_ICONS[workload.kind]} width={18} />
                </Box>
                <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                  <Typography variant="body2" noWrap>
                    {workload.name}
                  </Typography>
                </Box>
                <Chip size="small" variant="outlined" label={workload.kind} />
              </Box>
            )}
            renderInput={params => (
              <TextField
                {...params}
                label={t('Workload')}
                placeholder={t('Search Deployments, StatefulSets and DaemonSets')}
                helperText={
                  namespace
                    ? t('Workloads in namespace {{namespace}}', { namespace })
                    : t('Workloads in all namespaces')
                }
              />
            )}
          />
          {selected ? (
            <Box sx={{ mt: 2 }}>
              <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 0.5 }}>
                {t('Labels taken from {{kind}} {{name}}:', {
                  kind: selected.kind,
                  name: selected.name,
                })}
              </Typography>
              <SelectorView selector={selector} />
            </Box>
          ) : (
            !empty && (
              <Box sx={{ mt: 2 }}>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  component="div"
                  sx={{ mb: 0.5 }}
                >
                  {t('Current labels (they do not belong to a workload listed here):')}
                </Typography>
                <SelectorView selector={selector} />
              </Box>
            )
          )}
        </>
      )}

      {mode === 'custom' && (
        <>
          <LabelSelectorEditor
            label={t('Endpoint selector')}
            value={selector}
            onChange={v => onChange(v || { matchLabels: {} })}
            emptyText={
              namespace
                ? t('An empty selector matches every endpoint in namespace {{namespace}}.', {
                    namespace,
                  })
                : t('An empty selector matches every endpoint in the cluster.')
            }
          />
          <AvailableLabels selector={selector} onChange={onChange} namespace={namespace} />
        </>
      )}

      {mode === 'workload' && !selected && empty ? (
        <Alert
          sx={{ mt: 2 }}
          severity="info"
          icon={<Icon icon="mdi:cursor-default-click-outline" />}
        >
          {t('Choose the workload this policy protects. Its pod labels become the selector.')}
        </Alert>
      ) : (
        <MatchingEndpoints selector={selector} namespace={namespace} />
      )}
    </Box>
  );
}
