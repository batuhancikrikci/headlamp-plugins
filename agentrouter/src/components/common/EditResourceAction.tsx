import { ActionButton, AuthVisible } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { KubeObject, KubeObjectInterface } from '@kinvolk/headlamp-plugin/lib/K8s/cluster';
import { useSnackbar } from 'notistack';
import React, { useState } from 'react';
import { AI_GATEWAY_GROUP } from '../../resources/common';
import { ResourceEditorDialog } from './ResourceEditorDialog';

/** True for resources owned by this plugin (the aigateway.envoyproxy.io API group). */
export function isAIGatewayResource(resource: KubeObject | null): resource is KubeObject {
  return !!resource?.jsonData?.apiVersion?.startsWith(`${AI_GATEWAY_GROUP}/`);
}

/** Editable copy: drops server-managed noise that should not be sent back. */
function editableCopy(json: KubeObjectInterface): KubeObjectInterface {
  const copy = JSON.parse(JSON.stringify(json)) as KubeObjectInterface & { status?: unknown };
  delete copy.metadata.managedFields;
  delete copy.status;
  return copy;
}

/**
 * Replaces Headlamp's default detail-view Edit action for AI Gateway resources with the
 * plugin's editor (Editor + CRD Documentation tabs).
 */
export function EditResourceAction({ resource }: { resource: KubeObject }) {
  const { enqueueSnackbar } = useSnackbar();
  const [item, setItem] = useState<KubeObjectInterface | null>(null);
  const name = resource.metadata.name;

  async function save(docs: KubeObjectInterface[]) {
    if (docs.length !== 1) throw new Error('Edit exactly one resource document.');
    await resource.update(docs[0]);
    enqueueSnackbar(`Updated ${resource.kind} ${name}`, { variant: 'success' });
    setItem(null);
  }

  return (
    <AuthVisible item={resource} authVerb="update">
      <ActionButton
        description="Edit"
        icon="mdi:pencil"
        onClick={() => setItem(editableCopy(resource.jsonData))}
      />
      {item && (
        <ResourceEditorDialog
          open
          title={`Edit: ${resource.kind} ${name}`}
          items={[item]}
          primaryKind={resource.kind}
          onClose={() => setItem(null)}
          onSave={save}
        />
      )}
    </AuthVisible>
  );
}
