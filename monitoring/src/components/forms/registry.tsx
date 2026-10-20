import { Icon } from '@iconify/react';
import { CommonComponents } from '@kinvolk/headlamp-plugin/lib';
import { KubeObject } from '@kinvolk/headlamp-plugin/lib/K8s/cluster';
import {
  Box,
  Button,
  ButtonGroup,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Tooltip,
} from '@mui/material';
import React from 'react';
import { DocsDrawer } from '../../common/docs/DocsDrawer';
import { useText } from '../../common/i18n';
import { helmRelease, isHelmManaged } from '../../utils/relations';
import { HelmManagedAlert } from '../common/Feedback';
import {
  AlertmanagerConfigForm,
  newAlertmanagerConfig,
  validateAlertmanagerConfig,
} from './AlertmanagerConfigForm';
import { newMonitor, PodMonitorForm, ServiceMonitorForm, validateMonitor } from './MonitorForm';
import {
  newPrometheusRule,
  PrometheusRuleForm,
  validatePrometheusRule,
} from './PrometheusRuleForm';
import {
  editableCopy,
  FormIssue,
  Obj,
  ResourceEditorDialog,
  ResourceFormComponent,
} from './ResourceEditorDialog';
import {
  newProbe,
  newScrapeConfig,
  newWorkload,
  ProbeForm,
  ScrapeConfigForm,
  validateProbe,
  validateScrapeConfig,
  validateWorkload,
  WorkloadForm,
} from './WorkloadForm';

const { AuthVisible } = CommonComponents;

type T = (s: string, o?: Obj) => string;

interface FormDef {
  create: (namespace?: string) => Obj;
  /** Sectioned form used for "Create with form" and editing. */
  Form: ResourceFormComponent;
  /** Guided wizard, only where it adds value over the form. */
  Wizard?: ResourceFormComponent;
  validate: (value: Obj, t: T) => FormIssue[];
}

// Components are defined once at module level so their identity is stable
// across renders (an inline arrow would remount the form on every change).
const SMForm: ResourceFormComponent = p => <ServiceMonitorForm {...p} variant="form" />;
const SMWizard: ResourceFormComponent = p => <ServiceMonitorForm {...p} variant="wizard" />;
const PMForm: ResourceFormComponent = p => <PodMonitorForm {...p} variant="form" />;
const PMWizard: ResourceFormComponent = p => <PodMonitorForm {...p} variant="wizard" />;
const RuleForm: ResourceFormComponent = p => <PrometheusRuleForm {...p} variant="form" />;
const RuleWizard: ResourceFormComponent = p => <PrometheusRuleForm {...p} variant="wizard" />;
const AMCForm: ResourceFormComponent = p => <AlertmanagerConfigForm {...p} variant="form" />;
const AMCWizard: ResourceFormComponent = p => <AlertmanagerConfigForm {...p} variant="wizard" />;
const PromForm: ResourceFormComponent = p => <WorkloadForm {...p} kind="Prometheus" />;
const AgentForm: ResourceFormComponent = p => <WorkloadForm {...p} kind="PrometheusAgent" />;
const AMForm: ResourceFormComponent = p => <WorkloadForm {...p} kind="Alertmanager" />;
const RulerForm: ResourceFormComponent = p => <WorkloadForm {...p} kind="ThanosRuler" />;

export const FORMS: Record<string, FormDef> = {
  ServiceMonitor: {
    create: ns => newMonitor('ServiceMonitor', ns),
    Form: SMForm,
    Wizard: SMWizard,
    validate: (v, t) => validateMonitor('ServiceMonitor', v, t),
  },
  PodMonitor: {
    create: ns => newMonitor('PodMonitor', ns),
    Form: PMForm,
    Wizard: PMWizard,
    validate: (v, t) => validateMonitor('PodMonitor', v, t),
  },
  PrometheusRule: {
    create: newPrometheusRule,
    Form: RuleForm,
    Wizard: RuleWizard,
    validate: validatePrometheusRule,
  },
  AlertmanagerConfig: {
    create: newAlertmanagerConfig,
    Form: AMCForm,
    Wizard: AMCWizard,
    validate: validateAlertmanagerConfig,
  },
  Prometheus: {
    create: ns => newWorkload('Prometheus', ns),
    Form: PromForm,
    validate: (v, t) => validateWorkload('Prometheus', v, t),
  },
  PrometheusAgent: {
    create: ns => newWorkload('PrometheusAgent', ns),
    Form: AgentForm,
    validate: (v, t) => validateWorkload('PrometheusAgent', v, t),
  },
  Alertmanager: {
    create: ns => newWorkload('Alertmanager', ns),
    Form: AMForm,
    validate: (v, t) => validateWorkload('Alertmanager', v, t),
  },
  ThanosRuler: {
    create: ns => newWorkload('ThanosRuler', ns),
    Form: RulerForm,
    validate: (v, t) => validateWorkload('ThanosRuler', v, t),
  },
  Probe: { create: newProbe, Form: ProbeForm, validate: validateProbe },
  ScrapeConfig: { create: newScrapeConfig, Form: ScrapeConfigForm, validate: validateScrapeConfig },
};

interface ResourceClassLike {
  kind: string;
  apiName: string;
  apiVersion: string | string[];
}

type CreateMode = 'wizard' | 'form' | 'yaml';

/**
 * Split "Create" button (same as the envoy-gateway plugin): the main action
 * opens the wizard when there is one, otherwise the form; the menu offers
 * every available mode including raw YAML.
 *
 * Not wrapped in AuthVisible: a class-level check is cluster-wide and would
 * hide the button from namespace-scoped users; the API rejects unauthorized
 * requests anyway.
 */
export function CreateResourceMenu({
  resourceClass,
  namespace,
}: {
  resourceClass: ResourceClassLike;
  namespace?: string;
}) {
  const { t } = useText();
  const def = FORMS[resourceClass.kind];
  const [anchor, setAnchor] = React.useState<HTMLElement | null>(null);
  const [mode, setMode] = React.useState<CreateMode | null>(null);
  const [item, setItem] = React.useState<Obj | null>(null);
  const validate = React.useCallback((v: Obj) => (def ? def.validate(v, t) : []), [def, t]);
  if (!def) return null;

  const primary: CreateMode = def.Wizard ? 'wizard' : 'form';
  const docsApiVersion = Array.isArray(resourceClass.apiVersion)
    ? resourceClass.apiVersion[0]
    : resourceClass.apiVersion;
  const options: Array<{ mode: CreateMode; label: string; icon: string }> = [
    ...(def.Wizard
      ? [{ mode: 'wizard' as const, label: t('Create with wizard'), icon: 'mdi:wizard-hat' }]
      : []),
    { mode: 'form', label: t('Create with form'), icon: 'mdi:form-select' },
    { mode: 'yaml', label: t('Create from YAML'), icon: 'mdi:code-braces' },
  ];

  const open = (m: CreateMode) => {
    setAnchor(null);
    setItem(def.create(namespace || 'default'));
    setMode(m);
  };

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <DocsDrawer apiVersion={docsApiVersion} kind={resourceClass.kind} iconOnly />
      <ButtonGroup
        variant="contained"
        size="small"
        aria-label={t('Create {{kind}}', { kind: resourceClass.kind })}
      >
        <Button startIcon={<Icon icon="mdi:plus" />} onClick={() => open(primary)}>
          {t('Create')}
        </Button>
        <Button
          size="small"
          aria-label={t('More create options')}
          aria-haspopup="menu"
          onClick={e => setAnchor(e.currentTarget)}
        >
          <Icon icon="mdi:menu-down" />
        </Button>
      </ButtonGroup>
      <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)}>
        {options.map(o => (
          <MenuItem key={o.mode} onClick={() => open(o.mode)} selected={o.mode === primary}>
            <ListItemIcon>
              <Icon icon={o.icon} />
            </ListItemIcon>
            <ListItemText>{o.label}</ListItemText>
          </MenuItem>
        ))}
      </Menu>
      {item && mode && (
        <ResourceEditorDialog
          open
          onClose={() => {
            setMode(null);
            setItem(null);
          }}
          title={t('Create {{kind}}', { kind: resourceClass.kind })}
          initialItem={item}
          mode="create"
          Form={mode === 'wizard' ? def.Wizard : mode === 'form' ? def.Form : undefined}
          wizard={mode === 'wizard'}
          validate={validate}
        />
      )}
    </Box>
  );
}

/** Detail header action: edit the resource with its sectioned form. */
export function EditWithFormAction({ item }: { item: KubeObject | null }) {
  const { t } = useText();
  const [initial, setInitial] = React.useState<Obj | null>(null);
  const def = FORMS[item?.kind];
  const validate = React.useCallback((v: Obj) => (def ? def.validate(v, t) : []), [def, t]);
  if (!item || !def) return null;
  const json: Obj = item.jsonData;

  return (
    <AuthVisible item={item} authVerb="update">
      <Tooltip title={t('Edit with form')}>
        <IconButton aria-label={t('Edit with form')} onClick={() => setInitial(editableCopy(json))}>
          <Icon icon="mdi:form-select" />
        </IconButton>
      </Tooltip>
      {initial && (
        <ResourceEditorDialog
          open
          onClose={() => setInitial(null)}
          title={t('Edit {{kind}} {{name}}', { kind: item.kind, name: json.metadata?.name })}
          initialItem={initial}
          mode="edit"
          Form={def.Form}
          validate={validate}
          banner={
            isHelmManaged(item.jsonData) ? (
              <HelmManagedAlert release={helmRelease(item.jsonData)} />
            ) : undefined
          }
        />
      )}
    </AuthVisible>
  );
}
