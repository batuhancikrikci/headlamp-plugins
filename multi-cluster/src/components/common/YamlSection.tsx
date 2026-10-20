import { Icon } from '@iconify/react';
import { AuthVisible, SectionBox } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { KubeObject } from '@kinvolk/headlamp-plugin/lib/K8s/cluster';
import { Box, Button, FormControlLabel, Switch } from '@mui/material';
import React from 'react';
import { CodeBlock } from '../../common/CodeBlock';
import { ResourceEditor, ResourceFormComponent } from '../../common/form/ResourceEditor';
import { useText } from '../../common/i18n';
import { cleanForEdit } from '../../common/objects';
import { dumpYaml } from '../../common/yaml';
import { KubeJson } from '../../resources/models/common';

/**
 * YAML tab of every detail page: the live object as YAML (optionally without status and
 * managed fields) and an editor with the form, YAML and documentation tabs.
 */
export function YamlSection({
  item,
  Form,
  readOnly,
}: {
  item: KubeObject;
  Form?: ResourceFormComponent;
  readOnly?: boolean;
}) {
  const { t } = useText();
  const [full, setFull] = React.useState(false);
  const [editing, setEditing] = React.useState<KubeJson | null>(null);
  const shown = full ? item.jsonData : cleanForEdit(item.jsonData, true);
  return (
    <SectionBox
      title={t('YAML')}
      headerProps={{
        actions: [
          <FormControlLabel
            key="full"
            control={
              <Switch size="small" checked={full} onChange={e => setFull(e.target.checked)} />
            }
            label={t('Include status')}
          />,
          ...(readOnly
            ? []
            : [
                <AuthVisible key="edit" item={item} authVerb="update">
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<Icon icon="mdi:pencil" />}
                    onClick={() => setEditing(cleanForEdit(item.jsonData))}
                  >
                    {t('Edit YAML')}
                  </Button>
                </AuthVisible>,
              ]),
        ],
      }}
    >
      <Box>
        <CodeBlock value={dumpYaml(shown)} maxHeight={520} />
      </Box>
      {editing && (
        <ResourceEditor
          open
          onClose={() => setEditing(null)}
          title={t('Edit {{kind}} {{name}}', { kind: item.kind, name: item.metadata.name })}
          initialItem={editing}
          mode="edit"
          Form={Form}
          initialTab="yaml"
        />
      )}
    </SectionBox>
  );
}
