import { Icon } from '@iconify/react';
import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { getCluster } from '@kinvolk/headlamp-plugin/lib/Utils';
import {
  Autocomplete,
  Box,
  Button,
  CircularProgress,
  IconButton,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import React from 'react';
import { SelectInput } from '../../../common/form/Fields';
import { useText } from '../../../common/i18n';
import { GATEWAY_API_GROUP, KubeJson, TargetRef } from '../../../resources/types';
import {
  CLUSTER_SCOPED_KINDS,
  GATEWAY_API_PLURALS,
  SectionOption,
  sectionOptions,
} from '../../../utils/targets';

const GATEWAY_API_VERSIONS = ['v1', 'v1beta1', 'v1alpha2', 'v1alpha3'];

/** Served version per `${cluster}/${plural}`, so later lists hit the right endpoint directly. */
const servedVersion = new Map<string, string>();

interface ListState {
  items: KubeJson[] | null;
  notInstalled?: boolean;
  error?: string;
}

/**
 * Lists Gateway API objects of a kind. Works for every kind a policy can target, including the
 * experimental TCPRoute/UDPRoute/TLSRoute, by trying the Gateway API versions in order.
 */
export function useGatewayApiObjects(kind: string, namespace?: string): ListState {
  const [state, setState] = React.useState<ListState>({ items: null });

  React.useEffect(() => {
    const plural = GATEWAY_API_PLURALS[kind];
    if (!plural) {
      setState({ items: [], notInstalled: true });
      return;
    }
    let cancelled = false;
    setState({ items: null });
    const cluster = getCluster() || '';
    const cacheKey = `${cluster}/${plural}`;
    const cached = servedVersion.get(cacheKey);
    const versions = cached
      ? [cached, ...GATEWAY_API_VERSIONS.filter(v => v !== cached)]
      : GATEWAY_API_VERSIONS;
    const scope = !CLUSTER_SCOPED_KINDS.has(kind) && namespace ? `/namespaces/${namespace}` : '';

    (async () => {
      for (const version of versions) {
        try {
          const list: { items?: KubeJson[] } = await ApiProxy.request(
            `/apis/${GATEWAY_API_GROUP}/${version}${scope}/${plural}`,
            cluster ? { cluster } : {}
          );
          servedVersion.set(cacheKey, version);
          if (!cancelled) {
            const items = (list.items || []).map(i => ({ ...i, kind }));
            items.sort((a, b) => (a.metadata?.name || '').localeCompare(b.metadata?.name || ''));
            setState({ items });
          }
          return;
        } catch (err) {
          if ((err as { status?: number })?.status === 404) continue;
          if (!cancelled) setState({ items: [], error: (err as Error)?.message || String(err) });
          return;
        }
      }
      if (!cancelled) setState({ items: [], notInstalled: true });
    })();

    return () => {
      cancelled = true;
    };
  }, [kind, namespace]);

  return state;
}

function describeObject(obj: KubeJson, t: (k: string, o?: Record<string, unknown>) => string) {
  const parts: string[] = [];
  if (obj.kind === 'Gateway') {
    const listeners = obj.spec?.listeners?.length || 0;
    parts.push(t('{{n}} listeners', { n: listeners }));
    if (obj.spec?.gatewayClassName) parts.push(obj.spec.gatewayClassName);
  } else if (obj.kind === 'GatewayClass') {
    if (obj.spec?.controllerName) parts.push(obj.spec.controllerName);
  } else {
    const parents = (obj.spec?.parentRefs || []).map((p: { name: string }) => p.name);
    if (parents.length) parts.push(t('via {{gateways}}', { gateways: parents.join(', ') }));
    const hostnames: string[] = obj.spec?.hostnames || [];
    if (hostnames.length) parts.push(hostnames.join(', '));
  }
  return parts.join(' · ');
}

function OptionRow({ primary, secondary }: { primary: string; secondary?: string }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <Typography variant="body2">{primary}</Typography>
      {secondary && (
        <Typography variant="caption" color="text.secondary" noWrap>
          {secondary}
        </Typography>
      )}
    </Box>
  );
}

function TargetRefRow({
  target,
  kinds,
  namespace,
  withSection,
  onChange,
  onRemove,
}: {
  target: TargetRef;
  kinds: string[];
  namespace?: string;
  withSection: boolean;
  onChange: (next: TargetRef) => void;
  onRemove: () => void;
}) {
  const { t } = useText();
  const { items, notInstalled, error } = useGatewayApiObjects(target.kind, namespace);
  const loading = items === null;
  const options = items || [];
  const selected = options.find(o => o.metadata?.name === target.name);
  const hasSections = !CLUSTER_SCOPED_KINDS.has(target.kind);
  const sections: SectionOption[] = sectionOptions(selected);
  const sectionLabel = target.kind === 'Gateway' ? t('Listener') : t('Rule');

  let nameHelper: string | undefined;
  if (notInstalled)
    nameHelper = t('The {{kind}} API is not served by this cluster', { kind: target.kind });
  else if (error) nameHelper = t('Could not list: {{error}}', { error });
  else if (!loading && options.length === 0) {
    nameHelper = namespace
      ? t('No {{kind}} in namespace {{namespace}}', { kind: target.kind, namespace })
      : t('No {{kind}} found', { kind: target.kind });
  } else if (!loading && target.name && !selected) {
    nameHelper = t('No {{kind}} with this name was found', { kind: target.kind });
  } else if (!namespace) {
    nameHelper = t('Select the policy namespace first; targets must be in the same namespace.');
  }

  let sectionHelper: string | undefined;
  if (selected && sections.length === 0) {
    sectionHelper =
      target.kind === 'Gateway'
        ? t('This Gateway has no listeners')
        : t('This route has no named rules; name a rule to target it');
  } else if (
    target.sectionName &&
    selected &&
    !sections.some(s => s.value === target.sectionName)
  ) {
    sectionHelper = t('Not found on {{name}}', { name: target.name });
  }

  const setSection = (sectionName?: string | null) => {
    const next = { ...target, sectionName: sectionName || undefined };
    if (!next.sectionName) delete next.sectionName;
    onChange(next);
  };

  return (
    <Box
      sx={{
        display: 'grid',
        gap: 1.5,
        gridTemplateColumns: {
          xs: '1fr',
          md: withSection
            ? '150px minmax(0, 1fr) minmax(0, 0.8fr) 40px'
            : '150px minmax(0, 1fr) 40px',
        },
        alignItems: 'start',
        mb: 1.5,
      }}
    >
      <SelectInput
        label={t('Kind')}
        value={target.kind}
        allowEmpty={false}
        options={kinds}
        onChange={kind => onChange({ group: GATEWAY_API_GROUP, kind: kind || kinds[0], name: '' })}
      />
      <Autocomplete<KubeJson, false, false, true>
        freeSolo
        size="small"
        options={options}
        loading={loading}
        value={selected || (target.name ? target.name : null)}
        getOptionLabel={o => (typeof o === 'string' ? o : o.metadata?.name || '')}
        isOptionEqualToValue={(o, v) =>
          typeof v !== 'string' && o.metadata?.uid === v.metadata?.uid
        }
        onChange={(_, v) => {
          const name = typeof v === 'string' ? v : v?.metadata?.name || '';
          onChange({ group: GATEWAY_API_GROUP, kind: target.kind, name });
        }}
        onInputChange={(_, v, reason) => {
          if (reason === 'input')
            onChange({ group: GATEWAY_API_GROUP, kind: target.kind, name: v });
        }}
        renderOption={(props, o) => {
          const { key, ...rest } = props as typeof props & { key: string };
          return (
            <li {...rest} key={o.metadata?.uid || key}>
              <OptionRow
                primary={o.metadata?.name || ''}
                secondary={[namespace ? '' : o.metadata?.namespace, describeObject(o, t)]
                  .filter(Boolean)
                  .join(' · ')}
              />
            </li>
          );
        }}
        renderInput={params => (
          <TextField
            {...params}
            label={t('Name')}
            required
            placeholder={loading ? t('Loading…') : t('Select {{kind}}', { kind: target.kind })}
            helperText={nameHelper}
            error={!!error}
            InputProps={{
              ...params.InputProps,
              endAdornment: (
                <>
                  {loading && <CircularProgress size={16} />}
                  {params.InputProps.endAdornment}
                </>
              ),
            }}
          />
        )}
      />
      {withSection &&
        (hasSections ? (
          <Autocomplete<SectionOption, false, false, true>
            freeSolo
            size="small"
            options={sections}
            disabled={!target.name}
            value={sections.find(s => s.value === target.sectionName) || target.sectionName || null}
            getOptionLabel={o => (typeof o === 'string' ? o : o.value)}
            isOptionEqualToValue={(o, v) => typeof v !== 'string' && o.value === v.value}
            onChange={(_, v) => setSection(typeof v === 'string' ? v : v?.value)}
            onInputChange={(_, v, reason) => {
              if (reason === 'input') setSection(v);
            }}
            renderOption={(props, o) => {
              const { key, ...rest } = props as typeof props & { key: string };
              return (
                <li key={key} {...rest}>
                  <OptionRow primary={o.value} secondary={o.description} />
                </li>
              );
            }}
            renderInput={params => (
              <TextField
                {...params}
                label={sectionLabel}
                placeholder={t('Whole {{kind}}', { kind: target.kind })}
                helperText={
                  sectionHelper ||
                  (target.name ? undefined : t('Select a {{kind}} first', { kind: target.kind }))
                }
              />
            )}
          />
        ) : (
          <Box />
        ))}
      <Tooltip title={t('Remove')}>
        <IconButton aria-label={t('Remove')} onClick={onRemove} sx={{ mt: 0.25 }}>
          <Icon icon="mdi:close" />
        </IconButton>
      </Tooltip>
    </Box>
  );
}

export function emptyTargetRef(kind = 'Gateway'): TargetRef {
  return { group: GATEWAY_API_GROUP, kind, name: '' };
}

/**
 * Editor for `spec.targetRefs`: the target name is picked from the live objects of the chosen
 * kind in the policy namespace, and the section from the listeners / named rules of that object.
 */
export function TargetRefsEditor({
  value,
  onChange,
  kinds,
  namespace,
  withSection,
  single,
}: {
  value: TargetRef[] | undefined;
  onChange: (refs: TargetRef[] | undefined) => void;
  kinds: string[];
  namespace?: string;
  /** Show the sectionName picker (listener of a Gateway, named rule of a route). */
  withSection?: boolean;
  /** Only one target is allowed (e.g. EnvoyPatchPolicy.targetRef). */
  single?: boolean;
}) {
  const { t } = useText();
  const refs = value && value.length > 0 ? value : [];

  const update = (index: number, next: TargetRef) => {
    const copy = [...refs];
    copy[index] = next;
    onChange(copy);
  };
  const remove = (index: number) => {
    const copy = refs.filter((_, i) => i !== index);
    onChange(copy.length > 0 ? copy : undefined);
  };

  return (
    <Box>
      {refs.map((ref, index) => (
        <TargetRefRow
          // Rows have no identity of their own while being edited.
          // eslint-disable-next-line react/no-array-index-key
          key={index}
          target={ref}
          kinds={kinds}
          namespace={namespace}
          withSection={!!withSection}
          onChange={next => update(index, next)}
          onRemove={() => remove(index)}
        />
      ))}
      {(!single || refs.length === 0) && (
        <Button
          size="small"
          startIcon={<Icon icon="mdi:target" />}
          onClick={() => onChange([...refs, emptyTargetRef(kinds[0])])}
        >
          {t('Add target')}
        </Button>
      )}
    </Box>
  );
}
