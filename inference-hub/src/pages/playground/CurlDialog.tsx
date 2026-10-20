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

  const svcHost = resolved.inClusterUrl.replace(/^https?:\/\//, '');
  const scheme = resolved.inClusterUrl.startsWith('https') ? 'https' : 'http';
  const port = svcHost.split(':').pop() || '8000';
  const svcName = svcHost.split('.')[0];
  const resource = target.kind === 'Engine' ? `pod/${target.name}` : `svc/${svcName}`;

  let command = '';
  let note = '';
  if (variant === 'public' && target.publicUrl) {
    command = buildCurl(
      target.publicUrl,
      target.kind === 'InferenceService' ? resolved.apiPrefix : '/v1',
      model,
      example,
      params
    );
    note = t(
      'Uses the public URL of the endpoint (gateway or ingress). Add an Authorization header if your gateway requires one.'
    );
  } else if (variant === 'incluster') {
    command = buildCurl(resolved.inClusterUrl, resolved.apiPrefix, model, example, params);
    note = t('Run from a pod inside the cluster.');
  } else {
    command = [
      `kubectl port-forward -n ${target.namespace} ${resource} ${port}:${port} &`,
      buildCurl(`${scheme}://localhost:${port}`, resolved.apiPrefix, model, example, params),
    ].join('\n');
    note = t('Forwards the port to your machine with kubectl, then calls it locally.');
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
