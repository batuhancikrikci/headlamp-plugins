import { Icon } from '@iconify/react';
import { Loader, SectionBox } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Alert, Box, Button, Stack, Typography } from '@mui/material';
import React from 'react';
import { NotInstalled } from '../common/States';
import { CodeBlock } from '../components/common/CodeBlock';
import { KIND_AVAILABILITY_NOTES, kindInfo, KindName } from '../resources/registry';
import { Availability, isKindAvailable } from './availability';
import { useDiscovery } from './discovery';

/**
 * Empty state shown when the cluster does not serve the Gateway API at all. The guidance is
 * self-contained (no links), so it is just as useful on a cluster without internet access.
 */
export function GatewayApiNotInstalled({
  title,
  onRetry,
}: {
  title: string;
  onRetry?: () => void;
}) {
  return (
    <SectionBox title={title}>
      <Box sx={{ maxWidth: 860, mx: 'auto', py: 4, px: 2 }}>
        <Box sx={{ textAlign: 'center', mb: 3 }}>
          <Icon icon="mdi:lan-disconnect" width={56} style={{ opacity: 0.5 }} />
          <Typography variant="h6" sx={{ mt: 1 }}>
            The Gateway API is not installed in this cluster
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            No resources of the API group gateway.networking.k8s.io are served. Install the Gateway
            API CRDs and a controller that implements them to manage Gateways and routes here.
          </Typography>
        </Box>

        <Stack spacing={2.5}>
          <Box>
            <Typography variant="subtitle2" gutterBottom>
              1. Install the Gateway API CRDs
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              Every Gateway API release ships them as a single manifest (standard-install.yaml).
              Many controllers, Envoy Gateway among them, also install the CRDs with their own Helm
              chart. Apply the manifest server-side, because the CRDs are too large for a
              client-side apply:
            </Typography>
            <CodeBlock code="kubectl apply --server-side -f standard-install.yaml" />
          </Box>
          <Box>
            <Typography variant="subtitle2" gutterBottom>
              2. Install a controller
            </Typography>
            <Typography variant="body2" color="text.secondary">
              The CRDs alone do nothing: a Gateway API controller (for example Envoy Gateway) has to
              run in the cluster. It usually creates the GatewayClass that Gateways refer to.
            </Typography>
          </Box>
          {onRetry && (
            <Box sx={{ textAlign: 'center' }}>
              <Button variant="outlined" startIcon={<Icon icon="mdi:refresh" />} onClick={onRetry}>
                Check again
              </Button>
            </Box>
          )}
        </Stack>
      </Box>
    </SectionBox>
  );
}

/** Empty state shown when the Gateway API is installed but one kind is missing. */
export function KindNotInstalled({
  title,
  kind,
  availability,
  onRetry,
}: {
  title: string;
  kind: KindName;
  availability: Availability;
  onRetry?: () => void;
}) {
  const info = kindInfo(kind);
  const installed = availability.bundleVersion
    ? `Gateway API ${availability.bundleVersion}${
        availability.channel ? ` (${availability.channel} channel)` : ''
      }`
    : undefined;
  return (
    <NotInstalled
      title={title}
      kind={info.kind}
      group={info.group}
      onRetry={onRetry}
      hint={`The ${info.plural}.${info.group} CRD is not installed. ${
        KIND_AVAILABILITY_NOTES[info.kind]
      }${installed ? ` This cluster runs ${installed}.` : ''}`}
    />
  );
}

interface CRDGateProps {
  title: string;
  /** Kind that must be served; omit to only require the Gateway API itself. */
  kind?: KindName;
  children:
    | React.ReactNode
    | ((availability: Availability, refresh: () => void) => React.ReactNode);
}

/**
 * Waits for the API discovery of the current cluster, then renders its children when the required
 * kind is served, or an explanatory empty state otherwise.
 */
export function CRDGate({ title, kind, children }: CRDGateProps) {
  const state = useDiscovery();

  if (state.status === 'loading') {
    return <Loader title="Discovering the Gateway API…" />;
  }
  if (state.status === 'error') {
    return (
      <SectionBox title={title}>
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={state.retry}>
              Retry
            </Button>
          }
        >
          Could not discover the Gateway API of this cluster: {state.error}
        </Alert>
      </SectionBox>
    );
  }
  if (!state.availability.installed) {
    return <GatewayApiNotInstalled title={title} onRetry={state.refresh} />;
  }
  if (kind && !isKindAvailable(state.availability, kind)) {
    return (
      <KindNotInstalled
        title={title}
        kind={kind}
        availability={state.availability}
        onRetry={state.refresh}
      />
    );
  }
  return (
    <>{typeof children === 'function' ? children(state.availability, state.refresh) : children}</>
  );
}
