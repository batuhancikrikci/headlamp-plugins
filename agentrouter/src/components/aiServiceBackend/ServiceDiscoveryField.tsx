import { K8s } from '@kinvolk/headlamp-plugin/lib';
import { MenuItem } from '@mui/material';
import React, { useState } from 'react';
import { FieldGrid, SuggestInput, TextInput } from '../common/FormFields';
import { bestServicePort, portUsesTLS, serviceHostname, ServicePortLike } from './backendForm';

export interface DiscoveredEndpoint {
  hostname: string;
  port: number;
  tls: boolean;
}

const portLabel = (p: ServicePortLike) =>
  `${p.port}${p.name ? ` (${p.name})` : ''}${p.appProtocol ? ` · ${p.appProtocol}` : ''}`;

/**
 * Finds in-cluster model servers: pick a Service and its DNS name, port and TLS are filled
 * in automatically (the port is chosen from the Service's ports, see bestServicePort).
 */
export function ServiceDiscoveryField({
  onPick,
}: {
  onPick: (endpoint: DiscoveredEndpoint) => void;
}) {
  const [services, error] = K8s.ResourceClasses.Service.useList();
  const [selected, setSelected] = useState('');
  const [portValue, setPortValue] = useState('');

  const candidates = (services || []).filter(
    s => (s.jsonData.spec?.ports || []).length > 0 && s.jsonData.spec?.type !== 'ExternalName'
  );
  const current = candidates.find(s => `${s.metadata.namespace}/${s.metadata.name}` === selected);
  const ports: ServicePortLike[] = (current?.jsonData.spec?.ports || []) as ServicePortLike[];

  function pick(value: string) {
    setSelected(value);
    const svc = candidates.find(s => `${s.metadata.namespace}/${s.metadata.name}` === value);
    if (!svc) return;
    const port = bestServicePort(svc.jsonData.spec?.ports as ServicePortLike[]);
    if (!port) return;
    setPortValue(String(port.port));
    onPick({
      hostname: serviceHostname(svc.metadata.name, svc.metadata.namespace || 'default'),
      port: port.port,
      tls: portUsesTLS(port),
    });
  }

  function pickPort(value: string) {
    setPortValue(value);
    const port = ports.find(p => String(p.port) === value);
    if (!current || !port) return;
    onPick({
      hostname: serviceHostname(current.metadata.name, current.metadata.namespace || 'default'),
      port: port.port,
      tls: portUsesTLS(port),
    });
  }

  return (
    <FieldGrid>
      <SuggestInput
        label="In-cluster Service (optional)"
        value={selected}
        onChange={pick}
        loading={services === null && !error}
        options={candidates.map(s => {
          const labels = s.metadata.labels || {};
          const app = labels['app.kubernetes.io/name'] || labels.app || '';
          return {
            value: `${s.metadata.namespace}/${s.metadata.name}`,
            description: [
              app && `app ${app}`,
              `ports ${(s.jsonData.spec?.ports || []).map(p => p.port).join(', ')}`,
            ]
              .filter(Boolean)
              .join(' · '),
          };
        })}
        helperText={
          error
            ? 'Services could not be listed; enter the hostname manually.'
            : 'Pick a model server (vLLM, Ollama, TGI, …) to fill in hostname, port and TLS.'
        }
      />
      {current && ports.length > 1 && (
        <TextInput
          select
          label="Service port"
          value={portValue}
          onChange={e => pickPort(e.target.value)}
          helperText="Chosen automatically; change it if the API listens on another port."
        >
          {ports.map(p => (
            <MenuItem key={`${p.port}-${p.name}`} value={String(p.port)}>
              {portLabel(p)}
            </MenuItem>
          ))}
        </TextInput>
      )}
    </FieldGrid>
  );
}
