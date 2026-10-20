/**
 * Readable picture of a Cilium network policy: the selected endpoints in the middle, allowed and
 * denied ingress peers on the left, egress peers on the right. Built with plain MUI layout so it
 * follows the Headlamp theme in light and dark mode.
 */
import { Icon } from '@iconify/react';
import { Box, Chip, Paper, Tooltip, Typography } from '@mui/material';
import React from 'react';
import { useText } from '../../common/i18n';
import { Direction, PolicyRule } from '../../resources/networkPolicy';
import { FlowView, PeerType, PeerView, policyView, RuleView } from '../../utils/policyView';
import { CiliumLink, ResourceRefLink } from '../common/ResourceRefLink';

const PEER_ICONS: Record<PeerType, string> = {
  endpoints: 'mdi:cube-outline',
  entity: 'mdi:earth',
  cidr: 'mdi:ip-network-outline',
  cidrGroup: 'mdi:format-list-group',
  fqdn: 'mdi:web',
  service: 'mdi:lan',
  nodes: 'mdi:server',
  group: 'mdi:cloud-outline',
  any: 'mdi:asterisk',
  none: 'mdi:cancel',
};

function PeerChip({ peer, namespace }: { peer: PeerView; namespace?: string }) {
  let label: React.ReactNode = peer.label;
  if (peer.ref?.kind === 'CiliumCIDRGroup') {
    label = <CiliumLink kind="CiliumCIDRGroup" name={peer.ref.name} />;
  } else if (peer.ref?.kind === 'Service') {
    label = (
      <ResourceRefLink
        kind="Service"
        name={peer.ref.name}
        namespace={peer.ref.namespace || namespace}
        qualified={!!peer.ref.namespace}
      />
    );
  }
  return (
    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.75, mb: 0.5 }}>
      <Box sx={{ color: 'text.secondary', display: 'flex', mt: '2px' }}>
        <Icon icon={PEER_ICONS[peer.type]} width={16} />
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography
          variant="body2"
          component="div"
          sx={{ fontFamily: peer.ref ? undefined : 'monospace', wordBreak: 'break-word' }}
        >
          {label}
        </Typography>
        {peer.detail && (
          <Typography variant="caption" color="text.secondary">
            {peer.detail}
          </Typography>
        )}
      </Box>
    </Box>
  );
}

function FlowCard({ flow, namespace }: { flow: FlowView; namespace?: string }) {
  const { t } = useText();
  const allow = flow.action === 'allow';
  const accent = allow ? 'success.main' : 'error.main';
  return (
    <Paper
      variant="outlined"
      sx={{ p: 1.25, mb: 1, borderLeft: '4px solid', borderLeftColor: accent }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.75, color: accent }}>
        <Icon icon={allow ? 'mdi:check-circle-outline' : 'mdi:close-circle-outline'} width={16} />
        <Typography variant="caption" sx={{ fontWeight: 700, textTransform: 'uppercase' }}>
          {allow ? t('Allow') : t('Deny')}
        </Typography>
        {flow.auth && (
          <Tooltip title={t('Mutual authentication: {{mode}}', { mode: flow.auth })}>
            <Box sx={{ display: 'flex', ml: 0.5 }}>
              <Icon icon="mdi:account-lock-outline" width={16} />
            </Box>
          </Tooltip>
        )}
        {flow.tls && (
          <Tooltip title={t('TLS inspection')}>
            <Box sx={{ display: 'flex', ml: 0.5 }}>
              <Icon icon="mdi:lock-outline" width={16} />
            </Box>
          </Tooltip>
        )}
      </Box>
      {flow.peers.map(peer => (
        <PeerChip key={`${peer.type}-${peer.label}`} peer={peer} namespace={namespace} />
      ))}
      {(flow.ports.length > 0 || flow.icmp.length > 0) && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.75 }}>
          {flow.ports.map((port, i) => (
            // eslint-disable-next-line react/no-array-index-key
            <Chip key={`${port.label}-${i}`} size="small" variant="outlined" label={port.label} />
          ))}
          {flow.icmp.map(label => (
            <Chip key={label} size="small" variant="outlined" label={`ICMP ${label}`} />
          ))}
        </Box>
      )}
      {flow.ports.length === 0 && flow.icmp.length === 0 && flow.peers[0]?.type !== 'none' && (
        <Typography variant="caption" color="text.secondary">
          {t('All ports')}
        </Typography>
      )}
      {flow.l7.length > 0 && (
        <Box sx={{ mt: 0.75 }}>
          {flow.l7.map((rule, i) => (
            <Typography
              // eslint-disable-next-line react/no-array-index-key
              key={`${rule.protocol}-${rule.label}-${i}`}
              variant="caption"
              component="div"
              sx={{ fontFamily: 'monospace', wordBreak: 'break-word' }}
            >
              <Box component="span" sx={{ fontWeight: 700, mr: 0.5 }}>
                {rule.protocol}
              </Box>
              {rule.label}
            </Typography>
          ))}
        </Box>
      )}
    </Paper>
  );
}

function DirectionColumn({
  direction,
  rule,
  namespace,
}: {
  direction: Direction;
  rule: RuleView;
  namespace?: string;
}) {
  const { t } = useText();
  const flows = rule.flows.filter(f => f.direction === direction);
  const defaultDeny = rule.defaultDeny[direction];
  const title = direction === 'ingress' ? t('Ingress') : t('Egress');
  return (
    <Box sx={{ flex: 1, minWidth: 0 }}>
      <Typography variant="overline" color="text.secondary" component="div">
        {title}
      </Typography>
      {flows.map(flow => (
        <FlowCard key={flow.id} flow={flow} namespace={namespace} />
      ))}
      <Typography variant="caption" color="text.secondary" component="div">
        {flows.length === 0
          ? direction === 'ingress'
            ? t('No ingress rules: this policy does not restrict incoming traffic.')
            : t('No egress rules: this policy does not restrict outgoing traffic.')
          : defaultDeny
          ? direction === 'ingress'
            ? t('All other incoming traffic is denied.')
            : t('All other outgoing traffic is denied.')
          : t('Default deny is disabled: other traffic is not affected by this policy.')}
      </Typography>
    </Box>
  );
}

function Arrow() {
  return (
    <Box
      aria-hidden
      sx={{
        display: { xs: 'none', md: 'flex' },
        alignItems: 'center',
        color: 'text.disabled',
        pt: 4,
      }}
    >
      <Icon icon="mdi:arrow-right-thick" width={28} />
    </Box>
  );
}

function RuleDiagram({ rule, namespace }: { rule: RuleView; namespace?: string }) {
  const { t } = useText();
  const subjectText = rule.subject.all
    ? rule.subject.type === 'nodes'
      ? t('All nodes')
      : namespace
      ? t('All endpoints in {{namespace}}', { namespace })
      : t('All endpoints in the cluster')
    : rule.subject.selector;
  return (
    <Box sx={{ mb: 3, '&:last-child': { mb: 0 } }}>
      {rule.description && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          {rule.description}
        </Typography>
      )}
      <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, gap: 2 }}>
        <DirectionColumn direction="ingress" rule={rule} namespace={namespace} />
        <Arrow />
        <Box sx={{ flex: 0.8, minWidth: 0 }}>
          <Typography variant="overline" color="text.secondary" component="div">
            {rule.subject.type === 'nodes' ? t('Selected nodes') : t('Selected endpoints')}
          </Typography>
          <Paper
            variant="outlined"
            sx={{
              p: 1.5,
              borderColor: 'primary.main',
              borderWidth: 2,
              textAlign: 'center',
              bgcolor: 'action.hover',
            }}
          >
            <Box sx={{ color: 'primary.main', display: 'flex', justifyContent: 'center', mb: 0.5 }}>
              <Icon
                icon={rule.subject.type === 'nodes' ? 'mdi:server' : 'mdi:cube-outline'}
                width={28}
              />
            </Box>
            <Typography variant="body2" sx={{ fontFamily: 'monospace', wordBreak: 'break-word' }}>
              {subjectText}
            </Typography>
          </Paper>
        </Box>
        <Arrow />
        <DirectionColumn direction="egress" rule={rule} namespace={namespace} />
      </Box>
    </Box>
  );
}

/**
 * Visualizes the rules of a policy.
 *
 * @param namespace - namespace of a namespaced policy, used to describe implicit scoping.
 */
export function PolicyVisualization({
  rules,
  namespace,
}: {
  rules: PolicyRule[];
  namespace?: string;
}) {
  const { t } = useText();
  const views = React.useMemo(() => policyView(rules), [rules]);
  if (views.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        {t('This policy has no rules.')}
      </Typography>
    );
  }
  return (
    <Box>
      {views.map(view => (
        <Box key={view.index}>
          {views.length > 1 && (
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              {t('Rule set #{{index}}', { index: view.index + 1 })}
            </Typography>
          )}
          <RuleDiagram rule={view} namespace={namespace} />
        </Box>
      ))}
    </Box>
  );
}
