import { Icon } from '@iconify/react';
import { SectionBox } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Box, Chip, Typography } from '@mui/material';
import React from 'react';
import { DCGM_QUERIES, groupDcgm, metricsForNode } from '../api/dcgm';
import { t } from '../common/i18n';
import { useCoreList } from '../hooks/useLive';
import { usePromInstant } from '../hooks/usePromQuery';
import { NodeGpuDetails, ResourceBars } from '../pages/gpuFleet/GpuFleetPage';
import { buildInventory, NodeJson, sharingLabel } from '../resources/gpu';
import { PodJson } from '../resources/pod';
import { featuresOf, useSettings } from '../settings/settings';
import { formatBytes } from '../utils/quantity';

function NodeGpuSectionBody({ node }: { node: NodeJson }) {
  const pods = useCoreList<PodJson>('v1', 'pods', true, {
    fieldSelector: `spec.nodeName=${node.metadata.name},status.phase!=Succeeded,status.phase!=Failed`,
  });
  const dcgm = usePromInstant(DCGM_QUERIES);
  const [gpuNode] = React.useMemo(() => buildInventory([node], pods.items), [node, pods.items]);
  const metrics = React.useMemo(
    () => (dcgm.data ? metricsForNode(groupDcgm(dcgm.data), node.metadata.name) : undefined),
    [dcgm.data, node.metadata.name]
  );
  if (!gpuNode) return null;

  return (
    <SectionBox title={t('GPUs (Inference Hub)')}>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 3, alignItems: 'center', mb: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Icon icon="simple-icons:nvidia" width={22} />
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
            {gpuNode.product || t('GPU node')}
          </Typography>
          {gpuNode.memoryMiB && (
            <Chip size="small" label={formatBytes(gpuNode.memoryMiB * 2 ** 20, 0)} />
          )}
          <Chip size="small" variant="outlined" label={sharingLabel(gpuNode)} />
        </Box>
        <ResourceBars node={gpuNode} />
      </Box>
      <NodeGpuDetails node={gpuNode} metrics={metrics} />
    </SectionBox>
  );
}

/** Registered with registerDetailsViewSection; renders nothing for non-GPU nodes. */
export function NodeGpuSection({
  resource,
}: {
  resource: { kind?: string; jsonData?: unknown } | null;
}) {
  const settings = useSettings();
  if (!resource || resource.kind !== 'Node' || !featuresOf(settings).nodeGpuSection) return null;
  const node = resource.jsonData as NodeJson;
  const labels = node?.metadata?.labels || {};
  const capacity = node?.status?.capacity || {};
  const hasGpu =
    labels['nvidia.com/gpu.present'] === 'true' ||
    !!labels['nvidia.com/gpu.product'] ||
    Object.keys(capacity).some(k => k.startsWith('nvidia.com/'));
  if (!hasGpu) return null;
  return <NodeGpuSectionBody node={node} />;
}
