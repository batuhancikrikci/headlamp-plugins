import { Icon } from '@iconify/react';
import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import {
  Box,
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import React from 'react';
import { clusterParams } from '../../api/paths';
import { t } from '../../common/i18n';
import { EmptyState, ErrorState } from '../../common/States';
import { useCurrentCluster } from '../../hooks/useCluster';
import { podRole } from '../../resources/endpoint';
import { PodJson } from '../../resources/pod';

const TAIL_CHOICES = [100, 500, 2000];
const FOLLOW_MS = 3000;

async function fetchLogs(
  cluster: string,
  pod: PodJson,
  container: string,
  tailLines: number,
  previous: boolean
): Promise<string> {
  const params = new URLSearchParams({ container, tailLines: String(tailLines) });
  if (previous) params.set('previous', 'true');
  const path = `/api/v1/namespaces/${encodeURIComponent(
    pod.metadata.namespace || ''
  )}/pods/${encodeURIComponent(pod.metadata.name)}/log?${params}`;
  const response: Response = await ApiProxy.request(
    path,
    clusterParams(cluster, { isJSON: false })
  );
  return response.text();
}

/** Pod log viewer with container selection, follow mode, filtering and download. */
export function LogsPanel({ pods }: { pods: PodJson[] }) {
  const cluster = useCurrentCluster();
  const [podName, setPodName] = React.useState('');
  const [container, setContainer] = React.useState('');
  const [tail, setTail] = React.useState(500);
  const [follow, setFollow] = React.useState(true);
  const [previous, setPrevious] = React.useState(false);
  const [wrap, setWrap] = React.useState(true);
  const [filter, setFilter] = React.useState('');
  const [text, setText] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const scrollRef = React.useRef<HTMLPreElement>(null);
  // Fill the page down to the bottom of the window; the user can still drag the corner to resize.
  const [fitHeight, setFitHeight] = React.useState(480);
  React.useLayoutEffect(() => {
    const fit = () => {
      const el = scrollRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      setFitHeight(Math.max(320, Math.round(window.innerHeight - top - 40)));
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);

  const pod = pods.find(p => p.metadata.name === podName) || pods[0];
  const containers = (pod?.spec?.containers || []).map(c => c.name || '').filter(Boolean);
  const activeContainer = containers.includes(container)
    ? container
    : containers.find(c => c === 'main') || containers[0] || '';

  React.useEffect(() => {
    if (!pod || !activeContainer) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const logs = await fetchLogs(cluster, pod, activeContainer, tail, previous);
        if (cancelled) return;
        setText(logs);
        setError(null);
      } catch (err) {
        if (!cancelled) setError((err as Error)?.message || String(err));
      }
      if (!cancelled && follow && !previous) timer = setTimeout(load, FOLLOW_MS);
    };
    load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cluster, pod?.metadata.name, activeContainer, tail, follow, previous]);

  React.useEffect(() => {
    if (follow && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [text, follow]);

  if (!pod) {
    return (
      <EmptyState dense icon="mdi:text-box-remove-outline" title={t('No pods to show logs for')} />
    );
  }

  const lines = text.split('\n');
  const needle = filter.toLowerCase();
  const visible = needle ? lines.filter(l => l.toLowerCase().includes(needle)) : lines;

  const download = () => {
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${pod.metadata.name}-${activeContainer}.log`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center', mb: 1.5 }}>
        <FormControl size="small" sx={{ minWidth: 260 }}>
          <InputLabel id="ih-log-pod">{t('Pod')}</InputLabel>
          <Select
            labelId="ih-log-pod"
            label={t('Pod')}
            value={pod.metadata.name}
            onChange={e => setPodName(String(e.target.value))}
          >
            {pods.map(p => (
              <MenuItem key={p.metadata.name} value={p.metadata.name}>
                {p.metadata.name} · {podRole(p.metadata.labels)}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 160 }}>
          <InputLabel id="ih-log-container">{t('Container')}</InputLabel>
          <Select
            labelId="ih-log-container"
            label={t('Container')}
            value={activeContainer}
            onChange={e => setContainer(String(e.target.value))}
          >
            {containers.map(c => (
              <MenuItem key={c} value={c}>
                {c}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 120 }}>
          <InputLabel id="ih-log-tail">{t('Lines')}</InputLabel>
          <Select
            labelId="ih-log-tail"
            label={t('Lines')}
            value={tail}
            onChange={e => setTail(Number(e.target.value))}
          >
            {TAIL_CHOICES.map(n => (
              <MenuItem key={n} value={n}>
                {n}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <TextField
          size="small"
          label={t('Filter')}
          value={filter}
          onChange={e => setFilter(e.target.value)}
          sx={{ minWidth: 200 }}
        />
        <FormControlLabel
          control={<Switch checked={follow} onChange={e => setFollow(e.target.checked)} />}
          label={t('Follow')}
        />
        <FormControlLabel
          control={<Switch checked={previous} onChange={e => setPrevious(e.target.checked)} />}
          label={t('Previous container')}
        />
        <FormControlLabel
          control={<Switch checked={wrap} onChange={e => setWrap(e.target.checked)} />}
          label={t('Wrap')}
        />
        <Tooltip title={t('Download')}>
          <IconButton aria-label={t('Download')} onClick={download}>
            <Icon icon="mdi:download" />
          </IconButton>
        </Tooltip>
      </Box>
      {error && <ErrorState error={error} />}
      <Box
        component="pre"
        ref={scrollRef}
        sx={{
          m: 0,
          p: 1.5,
          height: fitHeight,
          minHeight: 200,
          resize: 'vertical',
          overflow: 'auto',
          bgcolor: 'grey.900',
          color: 'grey.100',
          borderRadius: 1,
          fontFamily: 'monospace',
          fontSize: '0.78rem',
          whiteSpace: wrap ? 'pre-wrap' : 'pre',
          wordBreak: wrap ? 'break-all' : 'normal',
        }}
      >
        {visible.join('\n') || ' '}
      </Box>
      <Typography variant="caption" color="text.secondary">
        {needle
          ? t('{{shown}} of {{total}} lines match', { shown: visible.length, total: lines.length })
          : t('{{total}} lines', { total: lines.length })}
      </Typography>
    </Box>
  );
}
