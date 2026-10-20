import { Icon } from '@iconify/react';
import { Alert, Box, Card, CardActionArea, Typography } from '@mui/material';
import React from 'react';
import { ResourceFormProps } from '../../common/form/ResourceEditor';
import { ValidationError } from '../../common/form/types';
import { SummaryList, Wizard } from '../../common/form/Wizard';
import { useText } from '../../common/i18n';
import { AUTH_METHODS, AuthMethod, SecurityPolicy } from '../../resources/securityPolicy';
import { isGeneralError } from '../../utils/validation';
import { FeatureChips, TargetRefsList } from '../common/SharedComponents';
import { spFeatures } from '../features';
import { SPGeneralSection } from './Form';
import { ManagedSecretsProvider, useManagedSecrets } from './ManagedSecretsProvider';
import {
  AUTH_DEFAULTS,
  AUTH_ICONS,
  AUTH_SECTIONS,
  AuthorizationSection,
  CORSSection,
  useAuthText,
} from './sections';

const AUTH_ERROR_PREFIXES = ['JWT', 'OIDC', 'Basic auth', 'API key', 'External auth'];

function isAuthError(e: ValidationError) {
  return AUTH_ERROR_PREFIXES.some(p => e.key.startsWith(p));
}

export function SecurityPolicyWizard(props: ResourceFormProps) {
  return (
    <ManagedSecretsProvider {...props}>
      <SecurityPolicyWizardSteps {...props} />
    </ManagedSecretsProvider>
  );
}

function SecurityPolicyWizardSteps({
  value,
  onChange,
  mode,
  errors,
  onSubmit,
  submitting,
}: ResourceFormProps) {
  const { t } = useText();
  const managedSecrets = useManagedSecrets();
  const authText = useAuthText();
  const spec = value.spec || {};
  const selected = AUTH_METHODS.filter(m => !!spec[m]);
  const section = { value, onChange };
  const preview = new SecurityPolicy(value as never);

  const toggleMethod = (m: AuthMethod) => {
    const nextSpec = { ...spec };
    if (nextSpec[m]) delete nextSpec[m];
    else nextSpec[m] = AUTH_DEFAULTS[m]();
    onChange({ ...value, spec: nextSpec });
  };

  return (
    <Wizard
      submitLabel={t('Create')}
      onSubmit={onSubmit}
      submitting={submitting}
      allErrors={errors}
      steps={[
        {
          id: 'target',
          label: t('Target'),
          description: t('Name the policy and choose what it protects.'),
          content: <SPGeneralSection value={value} onChange={onChange} mode={mode} />,
          errors: errors.filter(isGeneralError),
        },
        {
          id: 'methods',
          label: t('Authentication'),
          description: t(
            'Select one or more authentication methods. You can also skip this step and only use CORS or authorization.'
          ),
          optional: true,
          content: (
            <>
              <Box
                sx={{
                  display: 'grid',
                  gap: 2,
                  gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', lg: 'repeat(3, 1fr)' },
                }}
              >
                {AUTH_METHODS.map(m => {
                  const [title, description] = authText(m);
                  const isOn = selected.includes(m);
                  return (
                    <Card
                      key={m}
                      variant="outlined"
                      sx={{
                        borderColor: isOn ? 'primary.main' : undefined,
                        borderWidth: isOn ? 2 : 1,
                      }}
                    >
                      <CardActionArea
                        onClick={() => toggleMethod(m)}
                        sx={{ p: 2, height: '100%' }}
                        aria-pressed={isOn}
                      >
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                          <Box sx={{ color: 'primary.main', display: 'flex' }}>
                            <Icon icon={AUTH_ICONS[m]} width={24} />
                          </Box>
                          <Typography variant="subtitle1" sx={{ fontWeight: 600, flexGrow: 1 }}>
                            {title}
                          </Typography>
                          {isOn && <Icon icon="mdi:check-circle" />}
                        </Box>
                        <Typography variant="body2" color="text.secondary">
                          {description}
                        </Typography>
                      </CardActionArea>
                    </Card>
                  );
                })}
              </Box>
              {selected.includes('oidc') && selected.includes('jwt') && (
                <Alert severity="info" sx={{ mt: 2 }}>
                  {t(
                    'With both OIDC and JWT, browser sessions log in through OIDC while API clients can send bearer tokens.'
                  )}
                </Alert>
              )}
            </>
          ),
        },
        {
          id: 'details',
          label: t('Provider details'),
          description: t(
            'Configure the selected methods. API keys and basic auth users are stored in Secrets the plugin creates and updates; other Secrets are picked from the policy namespace.'
          ),
          content:
            selected.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                {t('No authentication method selected.')}
              </Typography>
            ) : (
              <>
                {selected.map(m => {
                  const Section = AUTH_SECTIONS[m];
                  return <Section key={m} {...section} />;
                })}
              </>
            ),
          errors: errors.filter(isAuthError),
        },
        {
          id: 'access',
          label: t('CORS & Authorization'),
          optional: true,
          description: t(
            'Optionally allow browser cross-origin calls and restrict access by client IP.'
          ),
          content: (
            <>
              <CORSSection {...section} />
              <AuthorizationSection {...section} />
            </>
          ),
          errors: errors.filter(e => !isGeneralError(e) && !isAuthError(e)),
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
                { label: t('Features'), value: <FeatureChips features={spFeatures(preview, t)} /> },
                {
                  label: t('Secrets'),
                  value: managedSecrets?.pending.length
                    ? managedSecrets.pending
                        .map(p =>
                          p.action === 'create'
                            ? t('{{name}} (created)', { name: p.name })
                            : p.action === 'update'
                            ? t('{{name}} (updated)', { name: p.name })
                            : t('{{name}} (deleted, no longer used)', { name: p.name })
                        )
                        .join(', ')
                    : '-',
                },
              ]}
            />
          ),
        },
      ]}
    />
  );
}
