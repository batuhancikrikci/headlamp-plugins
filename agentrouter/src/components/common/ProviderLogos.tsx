import { Icon, IconifyIcon } from '@iconify/react';
import { Box } from '@mui/material';
import React from 'react';
import {
  anthropicLogo,
  awsLogo,
  azureLogo,
  googleCloudLogo,
  ollamaLogo,
  openaiLogo,
  vllmLogo,
} from '../../icons/providerLogos';

/**
 * Master switch for third-party brand logos. Set to false to show text only
 * everywhere (wizard cards, review summary and API schema chips); nothing else changes.
 */
export const PROVIDER_LOGOS_ENABLED = true;

/**
 * Logos per "Connect a Provider" preset id: the model vendor first, then the hosting
 * platform (e.g. Anthropic on AWS Bedrock). Cohere has no Simple Icons logo, so a
 * neutral glyph is used instead.
 */
const PRESET_LOGOS: Record<string, Array<IconifyIcon | string>> = {
  openai: [openaiLogo],
  anthropic: [anthropicLogo],
  'aws-bedrock': [awsLogo],
  'aws-anthropic': [anthropicLogo, awsLogo],
  'azure-openai': [openaiLogo, azureLogo],
  'gcp-vertex': [googleCloudLogo],
  'gcp-anthropic': [anthropicLogo, googleCloudLogo],
  cohere: ['mdi:alpha-c-circle-outline'],
  'openai-compatible': [vllmLogo, ollamaLogo],
};

/** Logos per AIServiceBackend API schema (spec.schema.name). */
const SCHEMA_LOGOS: Record<string, Array<IconifyIcon | string>> = {
  OpenAI: [openaiLogo],
  Anthropic: [anthropicLogo],
  AWSBedrock: [awsLogo],
  AWSAnthropic: [anthropicLogo, awsLogo],
  AzureOpenAI: [openaiLogo, azureLogo],
  GCPVertexAI: [googleCloudLogo],
  GCPAnthropic: [anthropicLogo, googleCloudLogo],
  Cohere: ['mdi:alpha-c-circle-outline'],
};

/** Row of decorative logos; the surrounding text always names the provider. */
function LogoRow({
  logos,
  size,
}: {
  logos: Array<IconifyIcon | string> | undefined;
  size: number;
}) {
  if (!PROVIDER_LOGOS_ENABLED || !logos || logos.length === 0) return null;
  return (
    <Box
      component="span"
      aria-hidden
      sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}
    >
      {logos.map((logo, i) => (
        <Icon key={i} icon={logo} width={size} height={size} />
      ))}
    </Box>
  );
}

/** Logo(s) for a "Connect a Provider" preset card. */
export function ProviderLogos({ presetId, size = 24 }: { presetId: string; size?: number }) {
  return <LogoRow logos={PRESET_LOGOS[presetId]} size={size} />;
}

/** Logo(s) for an API schema name; returns null when there is none (or logos are off). */
export function schemaLogos(schemaName: string, size = 14): React.ReactElement | undefined {
  if (!PROVIDER_LOGOS_ENABLED || !SCHEMA_LOGOS[schemaName]) return undefined;
  return <LogoRow logos={SCHEMA_LOGOS[schemaName]} size={size} />;
}
