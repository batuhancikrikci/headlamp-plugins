import { Icon } from '@iconify/react';
import { Box, Card, CardActionArea, Chip, Typography } from '@mui/material';
import React from 'react';
import { ResourceFormProps } from '../../common/form/ResourceEditor';
import { SummaryList, Wizard } from '../../common/form/Wizard';
import { useText } from '../../common/i18n';
import { BackendTrafficPolicy } from '../../resources/backendTrafficPolicy';
import { activeBTPPresets, BTP_PRESETS, BTPPresetId, toggleBTPPreset } from '../../utils/templates';
import { isGeneralError } from '../../utils/validation';
import { FeatureChips, TargetRefsList } from '../common/SharedComponents';
import { btpFeatures } from '../features';
import { BTPGeneralSection } from './Form';
import {
  CircuitBreakerSection,
  CompressionSection,
  FaultInjectionSection,
  HealthCheckSection,
  LoadBalancerSection,
  RateLimitSection,
  RetrySection,
  TimeoutSection,
} from './sections';

const PRESET_ICONS: Record<BTPPresetId, string> = {
  rateLimit: 'mdi:speedometer',
  resilience: 'mdi:shield-refresh-outline',
  healthCheck: 'mdi:heart-pulse',
  stickySession: 'mdi:cookie-outline',
  slowStart: 'mdi:chart-bell-curve-cumulative',
  faultInjection: 'mdi:bug-outline',
  compression: 'mdi:zip-box-outline',
};

function usePresetText() {
  const { t } = useText();
  return (id: BTPPresetId) =>
    ({
      rateLimit: [
        t('Rate limiting'),
        t('Protect the backend with a request budget per second, minute or hour.'),
      ],
      resilience: [
        t('Resilience'),
        t('Timeouts, retries with backoff and a circuit breaker for flaky backends.'),
      ],
      healthCheck: [t('Health checks'), t('Probe endpoints and eject the ones that keep failing.')],
      stickySession: [t('Sticky sessions'), t('Keep a client on the same endpoint with a cookie.')],
      slowStart: [t('Slow start'), t('Ramp up traffic to new endpoints, e.g. during rollouts.')],
      faultInjection: [
        t('Fault injection'),
        t('Inject delays and errors to test resilience (non-production).'),
      ],
      compression: [t('Compression'), t('Compress responses with gzip, brotli or zstd.')],
    }[id]);
}

export function BackendTrafficPolicyWizard({
  value,
  onChange,
  mode,
  errors,
  onSubmit,
  submitting,
}: ResourceFormProps) {
  const { t } = useText();
  const presetText = usePresetText();
  const spec = value.spec || {};
  const active = activeBTPPresets(spec);
  const section = { value, onChange };

  const togglePreset = (id: BTPPresetId) => {
    const preset = BTP_PRESETS.find(p => p.id === id)!;
    let nextSpec = spec;
    const enabling = !active.includes(id);
    if (enabling && preset.group) {
      // Presets in the same group write the same keys; drop the others first.
      for (const other of BTP_PRESETS.filter(p => p.group === preset.group && p.id !== id)) {
        if (active.includes(other.id)) nextSpec = toggleBTPPreset(nextSpec, other.id, false);
      }
    }
    onChange({ ...value, spec: toggleBTPPreset(nextSpec, id, enabling) });
  };

  const configured = (key: string) => spec[key] !== undefined;
  const preview = new BackendTrafficPolicy(value as never);

  return (
    <Wizard
      submitLabel={t('Create')}
      onSubmit={onSubmit}
      submitting={submitting}
      allErrors={errors}
      steps={[
        {
          id: 'general',
          label: t('Target'),
          description: t('Name the policy and choose the Gateway or routes it applies to.'),
          content: <BTPGeneralSection value={value} onChange={onChange} mode={mode} />,
          errors: errors.filter(isGeneralError),
        },
        {
          id: 'scenarios',
          label: t('Scenarios'),
          description: t(
            'Pick what you want to achieve. Each scenario pre-fills sensible defaults you can tune in the next step.'
          ),
          content: (
            <Box
              sx={{
                display: 'grid',
                gap: 2,
                gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', lg: 'repeat(3, 1fr)' },
              }}
            >
              {BTP_PRESETS.map(p => {
                const [title, description] = presetText(p.id);
                const selected = active.includes(p.id);
                return (
                  <Card
                    key={p.id}
                    variant="outlined"
                    sx={{
                      borderColor: selected ? 'primary.main' : undefined,
                      borderWidth: selected ? 2 : 1,
                    }}
                  >
                    <CardActionArea
                      onClick={() => togglePreset(p.id)}
                      sx={{ p: 2, height: '100%' }}
                      aria-pressed={selected}
                    >
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                        <Box sx={{ color: 'primary.main', display: 'flex' }}>
                          <Icon icon={PRESET_ICONS[p.id]} width={24} />
                        </Box>
                        <Typography variant="subtitle1" sx={{ fontWeight: 600, flexGrow: 1 }}>
                          {title}
                        </Typography>
                        {selected && <Icon icon="mdi:check-circle" color="currentColor" />}
                      </Box>
                      <Typography variant="body2" color="text.secondary">
                        {description}
                      </Typography>
                    </CardActionArea>
                  </Card>
                );
              })}
            </Box>
          ),
        },
        {
          id: 'settings',
          label: t('Settings'),
          description: t(
            'Fine tune the selected scenarios. Sections that are switched off are not written to the policy.'
          ),
          content: (
            <>
              {Object.keys(spec).filter(
                k => !['targetRef', 'targetRefs', 'targetSelectors'].includes(k)
              ).length === 0 && (
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  {t('No scenario selected yet. You can also enable sections directly below.')}
                </Typography>
              )}
              <LoadBalancerSection {...section} />
              <RateLimitSection {...section} />
              <TimeoutSection {...section} />
              <RetrySection {...section} />
              <CircuitBreakerSection {...section} />
              <HealthCheckSection {...section} />
              <CompressionSection {...section} />
              {configured('faultInjection') && <FaultInjectionSection {...section} />}
            </>
          ),
          errors: errors.filter(e => !isGeneralError(e)),
        },
        {
          id: 'review',
          label: t('Review'),
          description: t('Check the summary, or open the YAML tab to review the full manifest.'),
          content: (
            <SummaryList
              rows={[
                { label: t('Name'), value: value.metadata?.name || '-' },
                { label: t('Namespace'), value: value.metadata?.namespace || '-' },
                {
                  label: t('Targets'),
                  value: (
                    <TargetRefsList
                      targetRefs={preview.targetRefs}
                      targetSelectors={preview.targetSelectors}
                      defaultNamespace={value.metadata?.namespace}
                    />
                  ),
                },
                {
                  label: t('Features'),
                  value: <FeatureChips features={btpFeatures(preview, t)} />,
                },
                {
                  label: t('Scenarios'),
                  value: active.length ? (
                    <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                      {active.map(id => (
                        <Chip key={id} size="small" label={presetText(id)[0]} />
                      ))}
                    </Box>
                  ) : (
                    '-'
                  ),
                },
              ]}
            />
          ),
        },
      ]}
    />
  );
}
