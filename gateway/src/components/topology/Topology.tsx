/**
 * Topology page: a left-to-right graph of GatewayClass → Gateway → Listener → Route → Backend.
 *
 * The graph and its layout are computed by pure functions (utils/topology.ts); this component
 * draws the nodes as cards with SVG connectors, and highlights the full path through the node
 * under the pointer (or keyboard focus).
 */
import { Icon } from '@iconify/react';
import { Router } from '@kinvolk/headlamp-plugin/lib';
import {
  Loader,
  SectionBox,
  SectionFilterHeader,
} from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import {
  Alert,
  Box,
  FormControlLabel,
  InputAdornment,
  Paper,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import React from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { GatewayApiData, useGatewayApiData } from '../../data/GatewayApiData';
import { useNamespaceFilter } from '../../data/useNamespaceFilter';
import { CRDGate } from '../../discovery/CRDGate';
import { findKind, KindName, ROUTE_KINDS } from '../../resources/registry';
import { HealthLevel } from '../../utils/conditions';
import {
  buildTopology,
  COLUMN_LABELS,
  connectedIds,
  EdgeState,
  filterTopology,
  layoutTopology,
  problemNodeIds,
  TopologyEdge,
  TopologyNode,
} from '../../utils/topology';
import { routeFor } from '../common/RefLink';
import { CreateMenu } from '../editor/EditActions';
import { ExposeServiceButton } from '../wizards/ExposeServiceWizard';

const NODE_WIDTH = 230;
const NODE_HEIGHT = 58;
const COLUMN_GAP = 96;
const ROW_GAP = 14;
const HEADER_HEIGHT = 36;
const PADDING = 16;

const TOPOLOGY_KINDS: KindName[] = [
  'GatewayClass',
  'Gateway',
  'ListenerSet',
  'ReferenceGrant',
  ...ROUTE_KINDS,
];

const CORE_ICONS: Record<string, string> = {
  Service: 'mdi:server-network',
  Listener: 'mdi:ear-hearing',
};

function iconFor(node: TopologyNode): string {
  if (CORE_ICONS[node.kind]) return CORE_ICONS[node.kind];
  return findKind(node.kind)?.icon || 'mdi:cube-outline';
}

function useLevelColors(): Record<HealthLevel, string> {
  const theme = useTheme();
  return {
    healthy: theme.palette.success.main,
    warning: theme.palette.warning.main,
    error: theme.palette.error.main,
    pending: theme.palette.text.disabled,
    none: theme.palette.divider,
  };
}

function useEdgeColors(): Record<EdgeState, string> {
  const theme = useTheme();
  return {
    ok: theme.palette.text.secondary,
    warning: theme.palette.warning.main,
    error: theme.palette.error.main,
    pending: theme.palette.text.disabled,
  };
}

function nodeUrl(node: TopologyNode): string | undefined {
  if (!node.ref || !node.ref.name) return undefined;
  const route = routeFor(node.ref);
  if (!route) return undefined;
  return Router.createRouteURL(
    route.route,
    route.namespaced
      ? { namespace: node.ref.namespace || '', name: node.ref.name }
      : { name: node.ref.name }
  );
}

function NodeTooltip({ node }: { node: TopologyNode }) {
  return (
    <Box sx={{ maxWidth: 360 }}>
      <strong>
        {node.kind} {node.namespace ? `${node.namespace}/` : ''}
        {node.label}
      </strong>
      {node.status && <Box>Status: {node.status}</Box>}
      {node.sublabel && <Box>{node.sublabel}</Box>}
      {node.notes.length > 0 && (
        <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 2 }}>
          {node.notes.slice(0, 5).map(note => (
            <li key={note}>{note}</li>
          ))}
        </Box>
      )}
    </Box>
  );
}

function NodeCard({
  node,
  x,
  y,
  dimmed,
  active,
  onFocus,
  onBlur,
}: {
  node: TopologyNode;
  x: number;
  y: number;
  dimmed: boolean;
  active: boolean;
  onFocus: () => void;
  onBlur: () => void;
}) {
  const colors = useLevelColors();
  const url = nodeUrl(node);
  const secondLine = [node.namespace, node.sublabel].filter(Boolean).join(' · ');
  const label = `${node.kind} ${node.namespace ? `${node.namespace}/` : ''}${node.label}${
    node.status ? `, ${node.status}` : ''
  }`;

  const card = (
    <Paper
      variant="outlined"
      sx={{
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        pl: 1.25,
        pr: 1,
        borderLeft: `4px solid ${colors[node.level]}`,
        borderColor: active ? 'primary.main' : undefined,
        borderLeftColor: colors[node.level],
        opacity: dimmed ? 0.3 : 1,
        transition: 'opacity 120ms, border-color 120ms',
        color: 'text.primary',
      }}
    >
      <Icon icon={iconFor(node)} width={22} aria-hidden style={{ flexShrink: 0 }} />
      <Box sx={{ minWidth: 0, flexGrow: 1 }}>
        <Typography variant="body2" noWrap sx={{ fontWeight: 600, lineHeight: 1.3 }}>
          {node.label}
        </Typography>
        <Typography
          variant="caption"
          color="text.secondary"
          noWrap
          sx={{ display: 'block', lineHeight: 1.3 }}
        >
          {secondLine || node.kind}
        </Typography>
      </Box>
      {(node.level === 'error' || node.level === 'warning') && (
        <Box sx={{ color: colors[node.level], display: 'inline-flex', flexShrink: 0 }}>
          <Icon
            icon={node.level === 'error' ? 'mdi:alert-circle' : 'mdi:alert'}
            width={18}
            aria-hidden
          />
        </Box>
      )}
    </Paper>
  );

  const interactive = {
    onMouseEnter: onFocus,
    onMouseLeave: onBlur,
    onFocus,
    onBlur,
    'aria-label': label,
  };

  return (
    <Tooltip title={<NodeTooltip node={node} />} placement="top" enterDelay={300}>
      <Box sx={{ position: 'absolute', left: x, top: y }}>
        {url ? (
          <Box
            component={RouterLink}
            to={url}
            sx={{ display: 'block', textDecoration: 'none', borderRadius: 1 }}
            {...interactive}
          >
            {card}
          </Box>
        ) : (
          <Box tabIndex={0} sx={{ borderRadius: 1 }} {...interactive}>
            {card}
          </Box>
        )}
      </Box>
    </Tooltip>
  );
}

function EdgePath({
  edge,
  from,
  to,
  dimmed,
  active,
}: {
  edge: TopologyEdge;
  from: { x: number; y: number };
  to: { x: number; y: number };
  dimmed: boolean;
  active: boolean;
}) {
  const colors = useEdgeColors();
  const x1 = from.x + NODE_WIDTH;
  const y1 = from.y + NODE_HEIGHT / 2;
  const x2 = to.x;
  const y2 = to.y + NODE_HEIGHT / 2;
  const bend = (x2 - x1) / 2;
  return (
    <path
      d={`M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`}
      fill="none"
      stroke={colors[edge.state]}
      strokeWidth={active ? 2.5 : 1.5}
      strokeDasharray={edge.dashed ? '6 4' : edge.state === 'pending' ? '2 4' : undefined}
      opacity={dimmed ? 0.12 : edge.state === 'ok' && !active ? 0.55 : 1}
    >
      {edge.note && <title>{edge.note}</title>}
    </path>
  );
}

function Legend() {
  const levels = useLevelColors();
  const edges = useEdgeColors();
  const item = (color: string, text: string, dashed?: boolean) => (
    <Stack direction="row" spacing={0.75} alignItems="center" key={text}>
      <Box
        sx={{
          width: 18,
          height: 0,
          borderTop: `3px ${dashed ? 'dashed' : 'solid'} ${color}`,
        }}
      />
      <Typography variant="caption" color="text.secondary">
        {text}
      </Typography>
    </Stack>
  );
  return (
    <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
      {item(levels.healthy, 'Healthy')}
      {item(levels.warning, 'Degraded')}
      {item(levels.error, 'Failing or broken link')}
      {item(levels.pending, 'Pending')}
      {item(edges.ok, 'Mirror / external auth', true)}
    </Stack>
  );
}

function TopologyContent() {
  const data = useGatewayApiData();
  const namespaces = useNamespaceFilter();
  const [search, setSearch] = React.useState('');
  const [problemsOnly, setProblemsOnly] = React.useState(false);
  const [focused, setFocused] = React.useState<string | null>(null);

  const topology = React.useMemo(
    () =>
      buildTopology({
        classes: data.json('GatewayClass') || [],
        gateways: data.json('Gateway') || [],
        listenerSets: data.json('ListenerSet') || [],
        routes: data.routes,
        grants: data.grants,
        services: data.error('Service') ? null : data.json('Service'),
        namespaceLabels: data.namespaceLabels,
        namespaces,
      }),
    [data, namespaces]
  );

  const visible = React.useMemo(() => {
    const text = search.trim().toLowerCase();
    if (!text && !problemsOnly) return topology;
    const problems = problemNodeIds(topology);
    return filterTopology(topology, node => {
      const matchesText =
        !text ||
        node.label.toLowerCase().includes(text) ||
        (node.namespace || '').toLowerCase().includes(text) ||
        (node.sublabel || '').toLowerCase().includes(text) ||
        node.kind.toLowerCase().includes(text);
      return matchesText && (!problemsOnly || problems.has(node.id));
    });
  }, [topology, search, problemsOnly]);

  const layout = React.useMemo(
    () =>
      layoutTopology(visible, {
        nodeWidth: NODE_WIDTH,
        nodeHeight: NODE_HEIGHT,
        columnGap: COLUMN_GAP,
        rowGap: ROW_GAP,
      }),
    [visible]
  );

  const highlight = React.useMemo(
    () => (focused && layout.positions[focused] ? connectedIds(visible, focused) : null),
    [visible, focused, layout]
  );

  const problemCount = React.useMemo(() => problemNodeIds(topology).size, [topology]);
  const count = (column: string) => topology.nodes.filter(node => node.column === column).length;

  return (
    <SectionBox
      title={
        <SectionFilterHeader
          title="Gateway API Topology"
          actions={[
            <ExposeServiceButton key="expose" />,
            <CreateMenu key="gateway" kind="Gateway" label="Create Gateway" />,
          ]}
        />
      }
    >
      <Stack
        direction="row"
        spacing={2}
        alignItems="center"
        flexWrap="wrap"
        useFlexGap
        sx={{ mb: 2 }}
      >
        <TextField
          size="small"
          placeholder="Filter by name, namespace or kind"
          value={search}
          onChange={event => setSearch(event.target.value)}
          inputProps={{ 'aria-label': 'Filter the topology' }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <Icon icon="mdi:magnify" />
              </InputAdornment>
            ),
          }}
          sx={{ minWidth: 280 }}
        />
        <FormControlLabel
          control={
            <Switch
              checked={problemsOnly}
              onChange={event => setProblemsOnly(event.target.checked)}
            />
          }
          label={`Only problems (${problemCount})`}
        />
        <Box sx={{ flexGrow: 1 }} />
        <Typography variant="body2" color="text.secondary">
          {count('gateway')} gateways · {count('listener')} listeners · {count('route')} routes ·{' '}
          {count('backend')} backends
        </Typography>
      </Stack>

      {data.loading ? (
        <Loader title="Loading the topology…" />
      ) : topology.nodes.length === 0 ? (
        <Alert severity="info">
          {namespaces.length > 0
            ? 'No Gateways or routes exist in the selected namespaces.'
            : 'No Gateways or routes exist yet. Create a Gateway, or use "Expose a Service" to create everything a Service needs in one go.'}
        </Alert>
      ) : visible.nodes.length === 0 ? (
        <Alert severity="info">Nothing matches the current filter.</Alert>
      ) : (
        <>
          <Paper variant="outlined" sx={{ overflow: 'auto', maxHeight: '70vh' }}>
            <Box
              sx={{
                position: 'relative',
                width: layout.width + PADDING * 2,
                height: layout.height + HEADER_HEIGHT + PADDING * 2,
                minWidth: '100%',
              }}
            >
              {layout.columns.map(column => (
                <Typography
                  key={column.column}
                  variant="overline"
                  color="text.secondary"
                  sx={{
                    position: 'absolute',
                    left: column.x + PADDING,
                    top: PADDING / 2,
                    width: NODE_WIDTH,
                  }}
                >
                  {COLUMN_LABELS[column.column]}
                </Typography>
              ))}
              <Box
                component="svg"
                aria-hidden
                sx={{
                  position: 'absolute',
                  left: PADDING,
                  top: HEADER_HEIGHT + PADDING,
                  width: layout.width,
                  height: layout.height,
                  overflow: 'visible',
                  pointerEvents: 'none',
                }}
              >
                {visible.edges.map(edge => {
                  const from = layout.positions[edge.source];
                  const to = layout.positions[edge.target];
                  if (!from || !to) return null;
                  return (
                    <EdgePath
                      key={edge.id}
                      edge={edge}
                      from={from}
                      to={to}
                      dimmed={!!highlight && !highlight.edges.has(edge.id)}
                      active={!!highlight && highlight.edges.has(edge.id)}
                    />
                  );
                })}
              </Box>
              <Box sx={{ position: 'absolute', left: PADDING, top: HEADER_HEIGHT + PADDING }}>
                {visible.nodes.map(node => {
                  const position = layout.positions[node.id];
                  if (!position) return null;
                  return (
                    <NodeCard
                      key={node.id}
                      node={node}
                      x={position.x}
                      y={position.y}
                      dimmed={!!highlight && !highlight.nodes.has(node.id)}
                      active={focused === node.id}
                      onFocus={() => setFocused(node.id)}
                      onBlur={() => setFocused(current => (current === node.id ? null : current))}
                    />
                  );
                })}
              </Box>
            </Box>
          </Paper>
          <Box sx={{ mt: 1.5 }}>
            <Legend />
          </Box>
        </>
      )}
    </SectionBox>
  );
}

/** Topology page of the Gateway API. */
export function Topology() {
  return (
    <CRDGate title="Gateway API Topology">
      {availability => (
        <GatewayApiData
          availability={availability}
          kinds={TOPOLOGY_KINDS}
          core={['Namespace', 'Service']}
        >
          <Box sx={{ pb: 6 }}>
            <TopologyContent />
          </Box>
        </GatewayApiData>
      )}
    </CRDGate>
  );
}
