import { K8s } from '@kinvolk/headlamp-plugin/lib';
import { MenuItem } from '@mui/material';
import React from 'react';
import { GatewayRefForm, newGatewayRef } from '../../utils/gatewayRefs';
import { FieldGrid, RepeatedField, SuggestInput, TextInput } from './FormFields';
import { useAutoSelectSingle } from './useAutoSelect';

export type { GatewayRefForm } from '../../utils/gatewayRefs';
export { gatewayRefErrors, newGatewayRef, toParentRefs } from '../../utils/gatewayRefs';

type GatewayObject = InstanceType<typeof K8s.ResourceClasses.Gateway>;

/** Finds the Gateway a form row points at (namespace defaults to the route's namespace). */
function findGateway(
  gateways: GatewayObject[] | null,
  name: string,
  namespace: string
): GatewayObject | undefined {
  return gateways?.find(gw => gw.metadata.name === name && gw.metadata.namespace === namespace);
}

function listenerLabel(l: { name: string; protocol: string; port: number; hostname?: string }) {
  return `${l.name} — ${l.protocol}:${l.port}${l.hostname ? ` (${l.hostname})` : ''}`;
}

/** Editor for one or more parent Gateway references, suggesting Gateways from the cluster. */
export function GatewayRefsField({
  refs,
  onChange,
  ownerNamespace,
  autoSelect = false,
}: {
  refs: GatewayRefForm[];
  onChange: (refs: GatewayRefForm[]) => void;
  ownerNamespace: string;
  /** Select the Gateway automatically when the cluster has exactly one. */
  autoSelect?: boolean;
}) {
  const [gateways, gatewaysError] = K8s.ResourceClasses.Gateway.useList();

  useAutoSelectSingle(
    gateways,
    refs.length === 1 && !refs[0].name,
    gw =>
      onChange([
        {
          name: gw.metadata.name,
          namespace: gw.metadata.namespace === ownerNamespace ? '' : gw.metadata.namespace || '',
          sectionName: '',
        },
      ]),
    autoSelect
  );
  const options = (gateways || []).map(gw => ({
    value: gw.metadata.name,
    description: `namespace: ${gw.metadata.namespace}, class: ${
      gw.jsonData.spec?.gatewayClassName || '-'
    }, listeners: ${(gw.jsonData.spec?.listeners || []).length}`,
  }));

  return (
    <RepeatedField
      items={refs}
      onChange={onChange}
      minItems={1}
      addLabel="Add Gateway"
      itemTitle={i => `Gateway ${i + 1}`}
      createItem={newGatewayRef}
      render={(g, update) => {
        const gateway = findGateway(gateways, g.name, g.namespace || ownerNamespace);
        const listeners = gateway?.jsonData.spec?.listeners || [];

        // Keep the listener only if the newly selected Gateway still has it.
        const retarget = (patch: Partial<GatewayRefForm>) => {
          const next = { ...g, ...patch };
          const target = findGateway(gateways, next.name, next.namespace || ownerNamespace);
          const keep =
            !next.sectionName ||
            !target ||
            (target.jsonData.spec?.listeners || []).some(l => l.name === next.sectionName);
          update({ ...patch, sectionName: keep ? next.sectionName : '' });
        };

        return (
          <FieldGrid>
            <SuggestInput
              label="Gateway name"
              required
              value={g.name}
              onChange={v => {
                // Prefer a Gateway in the namespace already chosen, then any namespace.
                const matches = (gateways || []).filter(gw => gw.metadata.name === v);
                const match =
                  matches.find(gw => gw.metadata.namespace === (g.namespace || ownerNamespace)) ||
                  matches[0];
                retarget({ name: v, namespace: match?.metadata.namespace || g.namespace });
              }}
              loading={gateways === null && !gatewaysError}
              options={options}
            />
            <TextInput
              label="Gateway namespace"
              value={g.namespace}
              placeholder={ownerNamespace}
              onChange={e => retarget({ namespace: e.target.value.trim() })}
              helperText="Defaults to the route's namespace."
            />
            {gateway ? (
              <TextInput
                select
                label="Listener (sectionName)"
                value={g.sectionName}
                onChange={e => update({ sectionName: e.target.value })}
                helperText="Attach to one listener, or to all listeners of the Gateway."
                SelectProps={{ displayEmpty: true }}
                InputLabelProps={{ shrink: true }}
              >
                <MenuItem value="">
                  <em>All listeners</em>
                </MenuItem>
                {listeners.map(l => (
                  <MenuItem key={l.name} value={l.name}>
                    {listenerLabel(l)}
                  </MenuItem>
                ))}
              </TextInput>
            ) : g.name && (gatewaysError || gateways !== null) ? (
              // Gateway not visible (e.g. no list permission): allow manual entry.
              <TextInput
                label="Listener (sectionName)"
                value={g.sectionName}
                onChange={e => update({ sectionName: e.target.value.trim() })}
                helperText="Gateway not found in the cluster; enter the listener name manually."
              />
            ) : (
              <TextInput
                select
                disabled
                label="Listener (sectionName)"
                value=""
                helperText="Select a Gateway first."
                SelectProps={{ displayEmpty: true }}
                InputLabelProps={{ shrink: true }}
              >
                <MenuItem value="">
                  <em>All listeners</em>
                </MenuItem>
              </TextInput>
            )}
          </FieldGrid>
        );
      }}
    />
  );
}
