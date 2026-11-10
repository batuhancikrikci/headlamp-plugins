import { Icon } from '@iconify/react';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Tab,
  Tabs,
  Typography,
} from '@mui/material';
import React from 'react';
import { buildCurl, ChatMessage, ChatParams, ResolvedTarget } from '../../api/openai';
import { requestHeaders } from '../../api/requestHeaders';
import { t } from '../../common/i18n';
import { CopyableCode } from '../../components/common/CopyableCode';
import { PlaygroundTarget } from '../../hooks/usePlaygroundTargets';

type Variant = 'public' | 'incluster' | 'portforward';

export function CurlDialog({
  open,
  onClose,
  target,
  resolved,
  model,
  messages,
  params,
}: {
  open: boolean;
  onClose: () => void;
  target: PlaygroundTarget;
  resolved: ResolvedTarget;
  model: string;
  messages: ChatMessage[];
  params: ChatParams;
}) {
  const variants: Variant[] = [
    ...(target.publicUrl ? (['public'] as Variant[]) : []),
    'incluster',
    'portforward',
  ];
  const [variant, setVariant] = React.useState<Variant>(variants[0]);
  const example: ChatMessage[] = messages.length
    ? messages
    : [{ role: 'user', content: 'Hello! What can you do?' }];

  // e.g. http://qwen-kserve-workload-svc.ai.svc:8000 or, through a gateway,
  // http://envoy-ai-gw-1a2b.envoy-gateway-system.svc:80/ai/qwen
  const url = new URL(resolved.inClusterUrl.replace('<pod-ip>', 'pod-ip'));
  const scheme = url.protocol.replace(':', '');
  const port = url.port || (scheme === 'https' ? '443' : '80');
  const [svcName, svcNamespace] = url.hostname.split('.');
  const path = url.pathname.replace(/\/$/, '');
  const resource = target.kind === 'Engine' ? `pod/${target.name}` : `svc/${svcName}`;
  const namespace = target.kind === 'Engine' ? target.namespace : svcNamespace;
  const headers = Object.keys(requestHeaders(resolved.headersKey));

  let command = '';
  let note = '';
  if (variant === 'public' && target.publicUrl) {
    command = buildCurl(
      target.publicUrl,
      target.kind === 'InferenceService' ? resolved.apiPrefix : '/v1',
      model,
      example,
      params,
      headers
    );
    note = t(
      'Uses the public URL of the endpoint (gateway or ingress). Add an Authorization header if your gateway requires one.'
    );
  } else if (variant === 'incluster') {
    command = buildCurl(resolved.inClusterUrl, resolved.apiPrefix, model, example, params, headers);
    note = t('Run from a pod inside the cluster.');
  } else {
    command = [
      `kubectl port-forward -n ${namespace} ${resource} ${port}:${port} &`,
      buildCurl(
        `${scheme}://localhost:${port}${path}`,
        resolved.apiPrefix,
        model,
        example,
        params,
        headers
      ),
    ].join('\n');
    note = t('Forwards the port to your machine with kubectl, then calls it locally.');
  }
  if (headers.length) {
    note = `${note} ${t('Replace the <header> placeholders with the values of your headers.')}`;
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{t('Copy as curl')}</DialogTitle>
      <DialogContent>
        <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
          <Tabs value={variant} onChange={(_, v) => setVariant(v)}>
            {variants.includes('public') && <Tab value="public" label={t('Public URL')} />}
            <Tab value="incluster" label={t('In-cluster')} />
            <Tab value="portforward" label={t('Port-forward')} />
          </Tabs>
        </Box>
        <Typography variant="body2" color="text.secondary">
          {note}
        </Typography>
        <CopyableCode code={command} maxHeight={420} />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} startIcon={<Icon icon="mdi:close" />}>
          {t('Close')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
