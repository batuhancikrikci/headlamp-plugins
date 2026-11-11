import { Icon } from '@iconify/react';
import { Alert, Box, Button, IconButton, TextField, Tooltip, Typography } from '@mui/material';
import React from 'react';
import { ChatTarget } from '../../api/openai';
import { HeaderRow, useHeaderRows } from '../../api/requestHeaders';
import { t } from '../../common/i18n';
import { useResourceList } from '../../hooks/useLive';
import {
  authHints,
  gatewayController,
  headerProblem,
  implementationName,
  readsEnvoyPolicies,
} from '../../resources/gatewayTargets';
import { KubeJson } from '../../resources/types';

function HeaderRowField({
  row,
  onChange,
  onRemove,
  disabled,
}: {
  row: HeaderRow;
  onChange: (row: HeaderRow) => void;
  onRemove: () => void;
  disabled?: boolean;
}) {
  const [shown, setShown] = React.useState(false);
  const problem = row.name ? headerProblem(row.name) : undefined;
  return (
    <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
      <TextField
        size="small"
        label={t('Header')}
        value={row.name}
        onChange={e => onChange({ ...row, name: e.target.value })}
        error={!!problem}
        helperText={problem ? t(problem) : undefined}
        disabled={disabled}
        sx={{ width: 220 }}
      />
      <TextField
        size="small"
        label={t('Value')}
        type={shown ? 'text' : 'password'}
        autoComplete="off"
        value={row.value}
        onChange={e => onChange({ ...row, value: e.target.value })}
        disabled={disabled}
        sx={{ flexGrow: 1, minWidth: 200 }}
        InputProps={{
          endAdornment: (
            <IconButton
              size="small"
              aria-label={shown ? t('Hide value') : t('Show value')}
              onClick={() => setShown(s => !s)}
            >
              <Icon icon={shown ? 'mdi:eye-off-outline' : 'mdi:eye-outline'} width={18} />
            </IconButton>
          ),
        }}
      />
      <Tooltip title={t('Remove')}>
        <span>
          <IconButton aria-label={t('Remove header')} onClick={onRemove} disabled={disabled}>
            <Icon icon="mdi:close" width={18} />
          </IconButton>
        </span>
      </Tooltip>
    </Box>
  );
}

/**
 * For a target reached through a gateway: which gateway and route, which implementation runs the
 * gateway, what its authentication policies expect when they can be read (Envoy Gateway
 * SecurityPolicies), and the request headers to send (e.g. an API key). Headers are kept for the
 * session only.
 */
export function GatewayAccess({ target, disabled }: { target?: ChatTarget; disabled?: boolean }) {
  const via = target?.gateway;
  const gateways = useResourceList<KubeJson>(
    'gateways',
    via ? { namespace: via.namespace } : null,
    60000
  );
  const classes = useResourceList<KubeJson>('gatewayclasses', via ? {} : null, 60000);
  const controller = via
    ? gatewayController(
        gateways.items.find(g => g.metadata.name === via.name),
        classes.items
      )
    : undefined;
  const envoy = readsEnvoyPolicies(controller);
  // Envoy Gateway's SecurityPolicies are read unless another implementation runs the gateway.
  const policies = useResourceList<KubeJson>(
    'securitypolicies',
    via && envoy !== false ? {} : null,
    60000
  );
  const [rows, setRows] = useHeaderRows(target?.id || '');
  if (!target || !via) return null;
  const hints = envoy === false ? [] : authHints(policies.items, via);
  const implementation = implementationName(controller);
  const add = (name = '') => setRows([...rows, { name, value: '' }]);
  const missing = Array.from(new Set(hints.flatMap(h => h.headers))).filter(
    name => !rows.some(r => r.name.trim().toLowerCase() === name.toLowerCase())
  );

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      {implementation && (
        <Typography variant="caption" color="text.secondary">
          {t('Gateway implementation: {{name}}', { name: implementation })}
        </Typography>
      )}
      <Typography variant="body2" color="text.secondary">
        {via.source === 'agentRouter'
          ? t(
              'Through Gateway {{gw}} and Agent Router route {{route}}: the requests run the routing and policies of the gateway.',
              { gw: `${via.namespace}/${via.name}`, route: via.routeName }
            )
          : t(
              'Through Gateway {{gw}} at {{path}}: the requests run the routing, the llm-d scheduler and the policies of the gateway.',
              { gw: `${via.namespace}/${via.name}`, path: via.pathPrefix }
            )}
      </Typography>
      {via.hostnames.length > 0 && (
        <Alert severity="warning">
          {t(
            'The route only accepts the hostnames {{hosts}}. Requests through the Kubernetes API proxy carry the address of the gateway service instead, so the gateway may answer 404.',
            { hosts: via.hostnames.join(', ') }
          )}
        </Alert>
      )}
      {hints.length > 0 && (
        <Alert
          severity={hints.some(h => h.unusable) ? 'warning' : 'info'}
          icon={<Icon icon="mdi:shield-key-outline" />}
          action={
            missing.length > 0 ? (
              <Button
                color="inherit"
                size="small"
                disabled={disabled}
                onClick={() => setRows([...rows, ...missing.map(name => ({ name, value: '' }))])}
              >
                {t('Add headers')}
              </Button>
            ) : undefined
          }
        >
          {hints.map(h => (
            <Typography variant="body2" key={`${h.policy}/${h.text}`}>
              {t('{{source}} {{policy}}: {{text}}.', {
                source: h.source,
                policy: h.policy,
                text: t(h.text),
              })}{' '}
              {h.unusable &&
                t('This cannot be sent through the Kubernetes API proxy; use the direct path.')}
            </Typography>
          ))}
        </Alert>
      )}
      {envoy === false && (
        <Typography variant="body2" color="text.secondary">
          {t(
            'The authentication policies of {{name}} are not read here. If the gateway asks for credentials (for example an API key), add the request headers it expects below.',
            { name: implementation }
          )}
        </Typography>
      )}
      {rows.map((row, index) => (
        <HeaderRowField
          key={index}
          row={row}
          disabled={disabled}
          onChange={next => setRows(rows.map((r, i) => (i === index ? next : r)))}
          onRemove={() => setRows(rows.filter((_, i) => i !== index))}
        />
      ))}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Button
          size="small"
          startIcon={<Icon icon="mdi:plus" />}
          onClick={() => add()}
          disabled={disabled}
        >
          {t('Add header')}
        </Button>
        <Typography variant="caption" color="text.secondary">
          {t('Headers are kept for this session only and never stored.')}
        </Typography>
      </Box>
    </Box>
  );
}
