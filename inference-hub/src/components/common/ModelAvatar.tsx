import { Icon } from '@iconify/react';
import { Avatar, Box, Chip, Tooltip, Typography } from '@mui/material';
import React from 'react';
import { t } from '../../common/i18n';
import { formatParams, GENERIC_MODEL_ICON, ModelInfo, SCHEME_INFO } from '../../utils/modelInfo';

/** Round avatar with the provider logo of a model. */
export function ModelAvatar({ model, size = 32 }: { model: ModelInfo; size?: number }) {
  return (
    <Tooltip title={model.provider?.label || t('Unknown provider')}>
      <Avatar
        variant="rounded"
        sx={{
          width: size,
          height: size,
          bgcolor: 'action.hover',
          color: 'text.primary',
          border: 1,
          borderColor: 'divider',
        }}
      >
        <Icon icon={model.provider?.icon || GENERIC_MODEL_ICON} width={size * 0.6} />
      </Avatar>
    </Tooltip>
  );
}

/** Small chips for size, quantization and variant. */
export function ModelTraits({ model }: { model: ModelInfo }) {
  const traits = [
    model.sizeLabel || formatParams(model.paramsB),
    model.quantization,
    model.variant,
  ].filter(Boolean) as string[];
  if (traits.length === 0) return null;
  return (
    <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
      {traits.map(trait => (
        <Chip key={trait} size="small" label={trait} sx={{ height: 20, fontSize: '0.7rem' }} />
      ))}
    </Box>
  );
}

/** Model cell for tables: avatar, name and traits. */
export function ModelCell({ model, servedName }: { model: ModelInfo; servedName?: string }) {
  const title = servedName || model.name || model.uri;
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0 }}>
      <ModelAvatar model={model} size={28} />
      <Box sx={{ minWidth: 0 }}>
        <Tooltip title={model.uri || title}>
          <Typography variant="body2" noWrap sx={{ maxWidth: 280 }}>
            {title}
          </Typography>
        </Tooltip>
        <ModelTraits model={model} />
      </Box>
    </Box>
  );
}

/** Storage URI with the icon of its scheme. */
export function StorageUri({ uri }: { uri: string }) {
  if (!uri) return <>—</>;
  const scheme =
    SCHEME_INFO[
      (Object.keys(SCHEME_INFO).find(s => uri.startsWith(`${s}://`)) ||
        'unknown') as keyof typeof SCHEME_INFO
    ];
  return (
    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, wordBreak: 'break-all' }}>
      <Tooltip title={scheme.label}>
        <Box component="span" sx={{ display: 'inline-flex', flexShrink: 0 }}>
          <Icon icon={scheme.icon} width={16} />
        </Box>
      </Tooltip>
      <Typography variant="body2" component="span" sx={{ fontFamily: 'monospace' }}>
        {uri}
      </Typography>
    </Box>
  );
}
