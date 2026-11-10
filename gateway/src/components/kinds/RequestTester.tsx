import { Icon } from '@iconify/react';
import { SectionBox } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import {
  Alert,
  Box,
  Button,
  Chip,
  IconButton,
  MenuItem,
  Paper,
  TextField,
  Typography,
} from '@mui/material';
import React from 'react';
import { GATEWAY_GROUP, KubeJson } from '../../resources/types';
import { NamespaceLabels } from '../../utils/attachment';
import { asArray, asRecord } from '../../utils/objects';
import { KeyValue, MatchCandidate, traceRequest } from '../../utils/requestMatch';
import { RefLink } from '../common/RefLink';

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

function KeyValueRows({
  label,
  rows,
  onChange,
}: {
  label: string;
  rows: KeyValue[];
  onChange: (rows: KeyValue[]) => void;
}) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      {rows.map((row, index) => (
        <Box key={index} sx={{ display: 'flex', gap: 1 }}>
          <TextField
            size="small"
            label={`${label} name`}
            value={row.name}
            onChange={e =>
              onChange(rows.map((r, i) => (i === index ? { ...r, name: e.target.value } : r)))
            }
          />
          <TextField
            size="small"
            label="Value"
            value={row.value}
            sx={{ flexGrow: 1 }}
            onChange={e =>
              onChange(rows.map((r, i) => (i === index ? { ...r, value: e.target.value } : r)))
            }
          />
          <IconButton
            aria-label={`Remove ${label.toLowerCase()}`}
            onClick={() => onChange(rows.filter((_, i) => i !== index))}
          >
            <Icon icon="mdi:close" width={18} />
          </IconButton>
        </Box>
      ))}
      <Box>
        <Button
          size="small"
          startIcon={<Icon icon="mdi:plus" />}
          onClick={() => onChange([...rows, { name: '', value: '' }])}
        >
          Add {label.toLowerCase()}
        </Button>
      </Box>
    </Box>
  );
}

function routeRef(candidate: MatchCandidate) {
  return {
    group: GATEWAY_GROUP,
    kind: 'HTTPRoute',
    namespace: candidate.route.metadata?.namespace,
    name: candidate.route.metadata?.name || '',
  };
}

function describeMatch(c: MatchCandidate): string {
  return [
    c.matchIndex === null ? 'any request (rule without matches)' : c.pathMatch,
    c.method,
    c.headerMatches ? `${c.headerMatches} header match(es)` : '',
    c.queryMatches ? `${c.queryMatches} query match(es)` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

function Winner({ candidate, namespace }: { candidate: MatchCandidate; namespace?: string }) {
  return (
    <Paper variant="outlined" sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <Icon icon="mdi:arrow-right-circle" width={20} />
        <Typography variant="body2">Handled by</Typography>
        <RefLink target={routeRef(candidate)} fromNamespace={namespace} showKind />
        <Typography variant="body2" color="text.secondary">
          rule {candidate.ruleIndex + 1} · {describeMatch(candidate)} · listener{' '}
          {candidate.listener}
          {candidate.hostname ? ` · host ${candidate.hostname}` : ''}
        </Typography>
      </Box>
      {candidate.filters.length > 0 && (
        <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', alignItems: 'center' }}>
          <Typography variant="body2" color="text.secondary">
            Filters:
          </Typography>
          {candidate.filters.map((f, i) => (
            <Chip key={i} size="small" variant="outlined" label={f} />
          ))}
        </Box>
      )}
      {candidate.backends.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          The rule has no backends
          {candidate.filters.includes('RequestRedirect')
            ? ': the request is redirected.'
            : '; the gateway answers 500.'}
        </Typography>
      ) : (
        <Box component="ul" sx={{ m: 0, pl: 3 }}>
          {candidate.backends.map((b, i) => (
            <li key={i}>
              <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
                <RefLink
                  target={b}
                  fromNamespace={candidate.route.metadata?.namespace}
                  suffix={b.port !== undefined ? `:${b.port}` : undefined}
                  showKind={b.kind !== 'Service'}
                />
                {candidate.backends.length > 1 && b.share !== undefined && (
                  <Typography variant="body2" color="text.secondary">
                    {Math.round(b.share * 100)}% of the requests
                  </Typography>
                )}
              </Box>
            </li>
          ))}
        </Box>
      )}
    </Paper>
  );
}

/**
 * "Test a request" section of a Gateway: which listener, HTTPRoute rule and backends would take
 * a request, computed from the objects in the cluster with the Gateway API matching rules.
 */
export function RequestTester({
  gateway,
  routes,
  namespaceLabels,
}: {
  gateway: KubeJson;
  routes: KubeJson[];
  namespaceLabels?: NamespaceLabels;
}) {
  const listeners = asArray<{ hostname?: string; port?: number; protocol?: string }>(
    asRecord(gateway.spec).listeners
  );
  const ports = Array.from(
    new Set(
      listeners
        .filter(l => l.protocol === 'HTTP' || l.protocol === 'HTTPS')
        .map(l => l.port)
        .filter((p): p is number => typeof p === 'number')
    )
  );
  const [host, setHost] = React.useState(
    () => listeners.find(l => l.hostname && !l.hostname.startsWith('*'))?.hostname || ''
  );
  const [port, setPort] = React.useState<number | ''>('');
  const [method, setMethod] = React.useState('GET');
  const [path, setPath] = React.useState('/');
  const [headers, setHeaders] = React.useState<KeyValue[]>([]);
  const [query, setQuery] = React.useState<KeyValue[]>([]);

  const trace = React.useMemo(
    () =>
      traceRequest(
        gateway,
        routes,
        {
          host,
          port: port === '' ? undefined : port,
          method,
          path: path || '/',
          headers: headers.filter(h => h.name),
          query: query.filter(q => q.name),
        },
        namespaceLabels
      ),
    [gateway, routes, host, port, method, path, headers, query, namespaceLabels]
  );
  const [winner, ...others] = trace.candidates;

  return (
    <SectionBox title="Test a request">
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Typography variant="body2" color="text.secondary">
          Shows which listener, HTTPRoute rule and backends would take an HTTP request, following
          the matching and precedence rules of the Gateway API. It is computed from the objects in
          the cluster; implementation extensions and policies are not taken into account.
        </Typography>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <TextField
            select
            size="small"
            label="Method"
            value={method}
            onChange={e => setMethod(e.target.value)}
            sx={{ width: 120 }}
          >
            {METHODS.map(m => (
              <MenuItem key={m} value={m}>
                {m}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            size="small"
            label="Host"
            placeholder="shop.example.com"
            value={host}
            onChange={e => setHost(e.target.value)}
            sx={{ minWidth: 220, flexGrow: 1 }}
          />
          <TextField
            select
            size="small"
            label="Port"
            value={port}
            onChange={e => setPort(e.target.value === '' ? '' : Number(e.target.value))}
            sx={{ width: 110 }}
          >
            <MenuItem value="">Any</MenuItem>
            {ports.map(p => (
              <MenuItem key={p} value={p}>
                {p}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            size="small"
            label="Path"
            value={path}
            onChange={e => {
              // A pasted "/path?a=b" fills the query parameters too.
              const [p, q] = e.target.value.split('?');
              setPath(p);
              if (q !== undefined) {
                setQuery(
                  q
                    .split('&')
                    .filter(Boolean)
                    .map(pair => {
                      const [name, ...value] = pair.split('=');
                      return { name, value: value.join('=') };
                    })
                );
              }
            }}
            sx={{ minWidth: 220, flexGrow: 2 }}
          />
        </Box>
        <Box sx={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          <KeyValueRows label="Header" rows={headers} onChange={setHeaders} />
          <KeyValueRows label="Query parameter" rows={query} onChange={setQuery} />
        </Box>

        {winner ? (
          <Winner candidate={winner} namespace={gateway.metadata?.namespace} />
        ) : (
          <Alert severity="warning">
            <Typography variant="body2">{trace.reason}</Typography>
            <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 2.5 }}>
              {trace.listeners.map(l => (
                <li key={l.name}>
                  <Typography variant="body2">
                    Listener {l.name} ({l.protocol} {l.port}
                    {l.hostname ? `, ${l.hostname}` : ''}):{' '}
                    {l.accepts ? 'accepts the request' : `not used, ${l.reason}`}
                  </Typography>
                </li>
              ))}
            </Box>
          </Alert>
        )}
        {trace.regexUsed && (
          <Alert severity="info">
            A RegularExpression path took part. Its precedence over other path matches depends on
            the implementation; it is ranked after Exact and PathPrefix here.
          </Alert>
        )}
        {others.length > 0 && (
          <Box>
            <Typography variant="subtitle2">Also matching, with lower precedence</Typography>
            <Box component="ul" sx={{ m: 0, pl: 3 }}>
              {others.slice(0, 5).map((c, i) => (
                <li key={i}>
                  <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
                    <RefLink target={routeRef(c)} fromNamespace={gateway.metadata?.namespace} />
                    <Typography variant="body2" color="text.secondary">
                      rule {c.ruleIndex + 1} · {describeMatch(c)}
                    </Typography>
                  </Box>
                </li>
              ))}
            </Box>
            {others.length > 5 && (
              <Typography variant="caption" color="text.secondary">
                and {others.length - 5} more
              </Typography>
            )}
          </Box>
        )}
      </Box>
    </SectionBox>
  );
}
