import { getCluster } from '@kinvolk/headlamp-plugin/lib/Utils';
import { Alert, Box, FormControlLabel, Switch, Typography } from '@mui/material';
import React from 'react';
import { servedApiVersion } from '../../api/discovery';
import { TextInput } from '../../common/form/Fields';
import { SetupWizardDialog } from '../../common/form/SetupWizardDialog';
import { SummaryList } from '../../common/form/Wizard';
import { useText } from '../../common/i18n';
import { isValidResourceName } from '../../common/objects';
import { useCiliumDiscovery } from '../../hooks/useDiscovery';
import { blockLabel } from '../../resources/network';
import { crd } from '../../resources/registry';
import { KubeJson } from '../../resources/types';
import { selectorToString } from '../../utils/selectors';
import { validateResource } from '../../utils/validation';
import { MatchingNodes } from '../common/MatchingNodes';
import { L2AnnouncementFields, LBIPPoolFields } from './Forms';

/**
 * Guided LoadBalancer setup: creates a CiliumLoadBalancerIPPool and, unless the addresses are
 * announced some other way (BGP), a CiliumL2AnnouncementPolicy for the same services.
 */
export function LBSetupWizard({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useText();
  const cluster = getCluster();
  const discovery = useCiliumDiscovery();
  const l2Info = crd('CiliumL2AnnouncementPolicy');
  const l2Available =
    discovery.status === 'ready' && !!discovery.availability.versions[l2Info.plural];

  const [pool, setPool] = React.useState<KubeJson>(() => ({
    apiVersion: servedApiVersion(crd('CiliumLoadBalancerIPPool').plural, cluster),
    kind: 'CiliumLoadBalancerIPPool',
    metadata: { name: 'lb-pool' },
    spec: { blocks: [{ cidr: '' }] },
  }));
  const [announce, setAnnounce] = React.useState(true);
  const [policy, setPolicy] = React.useState<KubeJson>(() => ({
    apiVersion: servedApiVersion(l2Info.plural, cluster),
    kind: 'CiliumL2AnnouncementPolicy',
    metadata: { name: 'lb-pool-l2' },
    spec: { loadBalancerIPs: true },
  }));

  const withL2 = announce && l2Available;
  // The announcement policy covers exactly the services that can get an IP from the pool.
  const l2Policy: KubeJson = React.useMemo(() => {
    const spec = { ...policy.spec };
    if (pool.spec?.serviceSelector) spec.serviceSelector = pool.spec.serviceSelector;
    else delete spec.serviceSelector;
    return { ...policy, spec };
  }, [policy, pool]);
  const resources = withL2 ? [pool, l2Policy] : [pool];
  const nameError = (name?: string) =>
    name && !isValidResourceName(name) ? t('Not a valid resource name') : undefined;

  return (
    <SetupWizardDialog
      open={open}
      onClose={onClose}
      title={t('LoadBalancer IP pool wizard')}
      resources={resources}
      summary={
        <SummaryList
          rows={[
            {
              label: t('Addresses'),
              value: (pool.spec?.blocks || []).map(blockLabel).join(', ') || '-',
            },
            {
              label: t('Services'),
              value: pool.spec?.serviceSelector
                ? selectorToString(pool.spec.serviceSelector) || t('All services')
                : t('All LoadBalancer services'),
            },
            {
              label: t('L2 announcement'),
              value: withL2
                ? t('Enabled on {{interfaces}}', {
                    interfaces: (l2Policy.spec?.interfaces || []).join(', ') || t('all interfaces'),
                  })
                : t('Not created'),
            },
          ]}
        />
      }
      steps={[
        {
          id: 'pool',
          label: t('IP pool'),
          description: t(
            'The addresses Cilium LB IPAM assigns to services of type LoadBalancer, and which services may use them.'
          ),
          errors: validateResource(pool),
          content: (
            <>
              <Box sx={{ maxWidth: 480, mb: 3 }}>
                <TextInput
                  label={t('Pool name')}
                  required
                  value={pool.metadata.name}
                  error={nameError(pool.metadata.name)}
                  onChange={v =>
                    setPool({ ...pool, metadata: { ...pool.metadata, name: v || '' } })
                  }
                />
              </Box>
              <LBIPPoolFields value={pool} onChange={setPool} />
            </>
          ),
        },
        {
          id: 'l2',
          label: t('L2 announcement'),
          description: t(
            'Assigned IPs must be made reachable. On a flat L2 network, Cilium can answer ARP/NDP for them; with BGP, advertise them instead and skip this step.'
          ),
          errors: withL2 ? validateResource(l2Policy) : [],
          optional: true,
          content: (
            <>
              {!l2Available && (
                <Alert severity="warning" sx={{ mb: 2 }}>
                  {t(
                    'The CiliumL2AnnouncementPolicy CRD is not installed. Enable L2 announcements in Cilium (l2announcements.enabled) or advertise the pool with BGP; only the pool will be created.'
                  )}
                </Alert>
              )}
              <FormControlLabel
                sx={{ mb: 2 }}
                control={
                  <Switch
                    checked={withL2}
                    disabled={!l2Available}
                    onChange={e => setAnnounce(e.target.checked)}
                  />
                }
                label={t('Announce the pool addresses with an L2 announcement policy')}
              />
              {withL2 && (
                <>
                  <Box sx={{ maxWidth: 480, mb: 3 }}>
                    <TextInput
                      label={t('Policy name')}
                      required
                      value={policy.metadata.name}
                      error={nameError(policy.metadata.name)}
                      onChange={v =>
                        setPolicy({ ...policy, metadata: { ...policy.metadata, name: v || '' } })
                      }
                    />
                  </Box>
                  <L2AnnouncementFields value={policy} onChange={setPolicy} hideServiceSelector />
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    component="div"
                    sx={{ mb: 0.5 }}
                  >
                    {t('Nodes that may announce:')}
                  </Typography>
                  <MatchingNodes selector={policy.spec?.nodeSelector} />
                  <Alert severity="info" sx={{ mt: 2 }}>
                    {t(
                      'The policy uses the service selector of the pool, so it announces exactly the services that receive an address from it.'
                    )}
                  </Alert>
                </>
              )}
            </>
          ),
        },
      ]}
    />
  );
}
