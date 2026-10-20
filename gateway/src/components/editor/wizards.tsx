/**
 * Step-by-step wizards for the kinds that benefit from guidance: Gateway and HTTPRoute.
 *
 * A wizard is the form of the kind cut into steps. It edits the same resource object through the
 * form context, so the YAML tab stays in sync and the result goes through the same review step.
 */
import {
  Alert,
  Box,
  Chip,
  FormControlLabel,
  Paper,
  Radio,
  RadioGroup,
  Stack,
  Typography,
} from '@mui/material';
import React from 'react';
import { useGatewayApiData } from '../../data/GatewayApiData';
import { KindName } from '../../resources/registry';
import {
  BackendRef,
  HTTPRouteFilter,
  HTTPRouteMatch,
  HTTPRouteRule,
  KubeJson,
  Listener,
} from '../../resources/types';
import { computeHealth } from '../../utils/conditions';
import {
  allowedRouteKinds,
  describeAllowedNamespaces,
  describeFilter,
  describeHTTPMatch,
  describeListener,
} from '../../utils/describe';
import { newHTTPRule, newListener } from '../../utils/drafts';
import { asArray, asRecord, asString, isPlainObject } from '../../utils/objects';
import { formatRef, resolveBackendRef, routeParentRefs } from '../../utils/refs';
import { controllerLabel } from '../../utils/templates';
import { HTTP_FILTER_TYPES } from '../../utils/validation';
import { HealthChip } from '../common/Status';
import { ArrayInput, FieldGrid, FormSection, TextInput } from './form/Fields';
import { useFieldIssue, useForm } from './form/FormContext';
import { GatewayClassInput } from './form/Pickers';
import {
  BackendRefsEditor,
  FiltersEditor,
  HostnamesSection,
  HTTPMatchesEditor,
  ListenerAllowedRoutesFields,
  ListenerBasicFields,
  ListenerTLSFields,
  MetadataSection,
  ParentRefsSection,
} from './form/sections';
import { GatewayAdvancedFields, HTTPRuleAdvancedFields, httpRuleTitle } from './forms';
import type { WizardProps } from './ResourceEditor';
import { ItemCards, SummaryList, WizardShell, WizardStep } from './WizardShell';

function ownsMetadata(path: string): boolean {
  return path === 'apiVersion' || path === 'kind' || path.startsWith('metadata');
}

// ---------------------------------------------------------------------------------------------
// Gateway
// ---------------------------------------------------------------------------------------------

/** GatewayClass selection as cards showing controller, description and status of each class. */
function GatewayClassCards() {
  const { get, set } = useForm();
  const data = useGatewayApiData();
  const { error, onBlur } = useFieldIssue('spec.gatewayClassName');
  const classes = data.json('GatewayClass');
  const selected = asString(get('spec.gatewayClassName'));

  // No classes to choose from (or still loading): fall back to typing the name.
  if (!classes || classes.length === 0) {
    return (
      <Stack spacing={2}>
        {classes && (
          <Alert severity="warning">
            No GatewayClass exists in this cluster. Install a Gateway API controller (it usually
            creates one) or create a GatewayClass first; you can still enter a class name.
          </Alert>
        )}
        <GatewayClassInput path="spec.gatewayClassName" />
      </Stack>
    );
  }

  return (
    <Box>
      <RadioGroup
        aria-label="Gateway class"
        value={selected}
        onChange={event => set('spec.gatewayClassName', event.target.value)}
        onBlur={onBlur}
      >
        <Stack spacing={1}>
          {classes.map(cls => {
            const name = cls.metadata?.name || '';
            const controller = asString(asRecord(cls.spec).controllerName);
            const description = asString(asRecord(cls.spec).description);
            const active = name === selected;
            return (
              <Paper
                key={name}
                variant="outlined"
                sx={{ px: 2, py: 1, borderColor: active ? 'primary.main' : undefined }}
              >
                <FormControlLabel
                  value={name}
                  control={<Radio />}
                  sx={{ width: '100%', m: 0, alignItems: 'flex-start' }}
                  label={
                    <Box sx={{ py: 0.5 }}>
                      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                        <Typography variant="subtitle2">{name}</Typography>
                        {controllerLabel(controller) && (
                          <Chip size="small" label={controllerLabel(controller)} />
                        )}
                        <HealthChip health={computeHealth(cls)} />
                      </Stack>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ display: 'block' }}
                      >
                        {controller}
                        {description ? ` — ${description}` : ''}
                      </Typography>
                    </Box>
                  }
                />
              </Paper>
            );
          })}
        </Stack>
      </RadioGroup>
      {error && (
        <Typography variant="caption" color="error" sx={{ display: 'block', mt: 1 }}>
          {error}
        </Typography>
      )}
    </Box>
  );
}

function listenerTitle(listener: Record<string, unknown>, index: number): string {
  return `${asString(listener?.name) || `Listener ${index + 1}`} — ${describeListener(
    listener as unknown as Listener
  )}`;
}

function needsTLS(listener: Record<string, unknown>): boolean {
  return listener?.protocol === 'HTTPS' || listener?.protocol === 'TLS';
}

function GatewaySummary() {
  const { value } = useForm();
  const spec = asRecord(value.spec);
  const listeners = asArray<Listener>(spec.listeners).filter(
    isPlainObject
  ) as unknown as Listener[];
  return (
    <SummaryList
      rows={[
        { label: 'Name', value: value.metadata?.name || '—' },
        { label: 'Namespace', value: value.metadata?.namespace || '—' },
        { label: 'Gateway class', value: asString(spec.gatewayClassName) || '—' },
        {
          label: `Listeners (${listeners.length})`,
          value: (
            <Stack spacing={1}>
              {listeners.map((listener, index) => {
                const certificates = asArray<{ name?: string; namespace?: string }>(
                  listener.tls?.certificateRefs
                );
                return (
                  <Box key={index}>
                    <strong>{listener.name || `Listener ${index + 1}`}</strong>:{' '}
                    {describeListener(listener)}
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                      {listener.tls
                        ? `TLS ${listener.tls.mode ?? 'Terminate'}${
                            certificates.length
                              ? ` with ${certificates
                                  .map(
                                    c => `${c?.namespace ? `${c.namespace}/` : ''}${c?.name || '?'}`
                                  )
                                  .join(', ')}`
                              : ''
                          }. `
                        : ''}
                      Routes: {describeAllowedNamespaces(listener.allowedRoutes)} (
                      {allowedRouteKinds(listener).join(', ') || 'implementation specific'})
                    </Typography>
                  </Box>
                );
              })}
            </Stack>
          ),
        },
      ]}
    />
  );
}

function GatewayWizard({ onReview, onRevealErrors }: WizardProps) {
  const { value, get } = useForm();
  const namespace = value.metadata?.namespace;

  const steps: WizardStep[] = [
    {
      id: 'class',
      label: 'Class',
      description:
        'Name the Gateway and choose its class. The class decides which controller provisions and configures it.',
      owns: path => ownsMetadata(path) || path === 'spec.gatewayClassName',
      content: (
        <>
          <MetadataSection namespaced />
          <FormSection title="Gateway class">
            <GatewayClassCards />
          </FormSection>
        </>
      ),
    },
    {
      id: 'listeners',
      label: 'Listeners',
      description:
        'Each listener opens one port for one protocol. Add an HTTPS listener to serve encrypted traffic; its certificate is chosen in the next step.',
      owns: path => /^spec\.listeners(\.\d+\.(name|port|protocol|hostname))?$/.test(path),
      content: (
        <ArrayInput<Record<string, unknown>>
          path="spec.listeners"
          itemLabel="listener"
          keepEmpty
          min={1}
          max={64}
          itemTitle={listenerTitle}
          newItem={() => newListener(get('spec.listeners'))}
          renderItem={itemPath => <ListenerBasicFields path={itemPath} />}
        />
      ),
    },
    {
      id: 'tls',
      label: 'TLS',
      optional: !asArray<Record<string, unknown>>(get('spec.listeners')).some(needsTLS),
      description:
        'HTTPS listeners terminate TLS with a certificate stored in a Secret of type kubernetes.io/tls. TLS listeners either terminate or pass the encrypted connection through.',
      owns: path => /^spec\.listeners\.\d+\.tls/.test(path),
      content: (
        <ItemCards<Record<string, unknown>>
          path="spec.listeners"
          title={listenerTitle}
          filter={needsTLS}
          empty={
            <Alert severity="info">
              None of the listeners uses HTTPS or TLS, so there is nothing to configure here. Go
              back to add an HTTPS listener if the Gateway should serve encrypted traffic.
            </Alert>
          }
        >
          {itemPath => <ListenerTLSFields path={itemPath} namespace={namespace} />}
        </ItemCards>
      ),
    },
    {
      id: 'routes',
      label: 'Allowed routes',
      description:
        'Decide which routes may attach to each listener. By default only routes in the namespace of the Gateway can; allow other namespaces to let application teams bring their own routes.',
      owns: path => /^spec\.listeners\.\d+\.allowedRoutes/.test(path),
      content: (
        <Stack spacing={3}>
          <ItemCards<Record<string, unknown>>
            path="spec.listeners"
            title={listenerTitle}
            empty={<Alert severity="info">Add a listener first.</Alert>}
          >
            {itemPath => <ListenerAllowedRoutesFields path={itemPath} />}
          </ItemCards>
          <GatewayAdvancedFields />
        </Stack>
      ),
    },
  ];

  return (
    <WizardShell
      steps={steps}
      summary={<GatewaySummary />}
      onReview={onReview}
      onRevealErrors={onRevealErrors}
      reviewLabel="Review and create"
    />
  );
}

// ---------------------------------------------------------------------------------------------
// HTTPRoute
// ---------------------------------------------------------------------------------------------

/** Hostnames of the listeners the route attaches to, as a hint for the hostname step. */
function ListenerHostnameHint() {
  const { value } = useForm();
  const data = useGatewayApiData();
  const parents = [...(data.json('Gateway') || []), ...(data.json('ListenerSet') || [])];
  const hostnames = new Set<string>();
  let anyWildcardListener = false;

  for (const ref of routeParentRefs(value)) {
    const parent = parents.find(
      (candidate: KubeJson) =>
        candidate.kind === ref.kind &&
        candidate.metadata?.name === ref.name &&
        candidate.metadata?.namespace === ref.namespace
    );
    for (const listener of asArray<Listener>(asRecord(parent?.spec).listeners)) {
      if (!isPlainObject(listener)) continue;
      if (ref.sectionName && listener.name !== ref.sectionName) continue;
      if (listener.hostname) hostnames.add(asString(listener.hostname));
      else anyWildcardListener = true;
    }
  }

  if (hostnames.size === 0) return null;
  return (
    <Alert severity="info" sx={{ mb: 2 }}>
      The selected listeners serve: {[...hostnames].join(', ')}
      {anyWildcardListener ? ' (and a listener without hostname restriction)' : ''}. Route hostnames
      must overlap with them; leave the list empty to inherit the listener hostnames.
    </Alert>
  );
}

function HTTPRouteSummary() {
  const { value } = useForm();
  const namespace = value.metadata?.namespace;
  const spec = asRecord(value.spec);
  const rules = asArray<HTTPRouteRule>(spec.rules).filter(
    isPlainObject
  ) as unknown as HTTPRouteRule[];
  const hostnames = asArray<string>(spec.hostnames);
  const parents = routeParentRefs(value);

  return (
    <SummaryList
      rows={[
        { label: 'Name', value: value.metadata?.name || '—' },
        { label: 'Namespace', value: namespace || '—' },
        {
          label: 'Parents',
          value:
            parents.length === 0
              ? 'None (the route will not receive traffic)'
              : parents
                  .map(
                    ref =>
                      `${formatRef(ref, { omitKind: 'Gateway' })}${
                        ref.sectionName ? ` / ${ref.sectionName}` : ''
                      }`
                  )
                  .join(', '),
        },
        {
          label: 'Hostnames',
          value: hostnames.length ? hostnames.join(', ') : 'Any (inherited from the listeners)',
        },
        {
          label: `Rules (${rules.length})`,
          value: (
            <Stack spacing={1.5}>
              {rules.map((rule, index) => {
                const matches = asArray<HTTPRouteMatch>(rule.matches);
                const filters = asArray<HTTPRouteFilter>(rule.filters);
                const backends = asArray<BackendRef>(rule.backendRefs).filter(isPlainObject);
                return (
                  <Box key={index}>
                    <strong>
                      Rule {index + 1}
                      {rule.name ? ` (${rule.name})` : ''}
                    </strong>
                    <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                      <li>
                        Match:{' '}
                        {matches.length
                          ? matches.map(describeHTTPMatch).join(' | ')
                          : 'all requests'}
                      </li>
                      {filters.map((filter, filterIndex) => (
                        <li key={filterIndex}>{describeFilter(filter)}</li>
                      ))}
                      <li>
                        Forward to:{' '}
                        {backends.length
                          ? backends
                              .map(ref => {
                                const backend = ref as unknown as BackendRef;
                                return `${formatRef(resolveBackendRef(backend, namespace), {
                                  omitKind: 'Service',
                                })}${
                                  backend.weight !== undefined ? ` (weight ${backend.weight})` : ''
                                }`;
                              })
                              .join(', ')
                          : 'no backend'}
                      </li>
                    </Box>
                  </Box>
                );
              })}
            </Stack>
          ),
        },
      ]}
    />
  );
}

function HTTPRouteWizard({ onReview, onRevealErrors }: WizardProps) {
  const { value } = useForm();
  const namespace = value.metadata?.namespace;

  const steps: WizardStep[] = [
    {
      id: 'parents',
      label: 'Parents',
      description:
        'Name the route and choose the Gateway that should serve it. The preview shows whether the listeners accept a route from this namespace.',
      owns: path => ownsMetadata(path) || path.startsWith('spec.parentRefs'),
      content: (
        <>
          <MetadataSection namespaced />
          <ParentRefsSection />
        </>
      ),
    },
    {
      id: 'hostnames',
      label: 'Hostnames',
      optional: true,
      owns: path => path.startsWith('spec.hostnames'),
      content: (
        <>
          <ListenerHostnameHint />
          <HostnamesSection />
        </>
      ),
    },
    {
      id: 'matches',
      label: 'Matches',
      description:
        'Each rule handles the requests that satisfy any of its matches. Add a rule for every set of requests that needs different filters or backends.',
      owns: path => /^spec\.rules(\.\d+(\.(name|matches.*))?)?$/.test(path),
      content: (
        <ArrayInput<HTTPRouteRule>
          path="spec.rules"
          itemLabel="rule"
          keepEmpty
          min={1}
          max={16}
          itemTitle={httpRuleTitle}
          newItem={newHTTPRule}
          renderItem={rulePath => (
            <Stack spacing={2}>
              <FieldGrid>
                <TextInput path={`${rulePath}.name`} label="Rule name" help="Optional" />
              </FieldGrid>
              <HTTPMatchesEditor path={`${rulePath}.matches`} />
            </Stack>
          )}
        />
      ),
    },
    {
      id: 'filters',
      label: 'Filters',
      optional: true,
      description:
        'Filters change the request or response on its way: modify headers, redirect, rewrite the URL, mirror traffic or apply CORS. A rule that redirects needs no backend.',
      owns: path => /^spec\.rules\.\d+\.filters/.test(path),
      content: (
        <ItemCards<HTTPRouteRule>
          path="spec.rules"
          title={httpRuleTitle}
          empty={<Alert severity="info">Add a rule first.</Alert>}
        >
          {rulePath => (
            <FiltersEditor
              path={`${rulePath}.filters`}
              types={HTTP_FILTER_TYPES}
              namespace={namespace}
            />
          )}
        </ItemCards>
      ),
    },
    {
      id: 'backends',
      label: 'Backends',
      description:
        'Choose the Services that receive the matching requests. With several backends, traffic is split by weight (for example 90 / 10 for a canary).',
      owns: path => /^spec\.rules\.\d+\.(backendRefs|timeouts|retry|sessionPersistence)/.test(path),
      content: (
        <ItemCards<HTTPRouteRule>
          path="spec.rules"
          title={httpRuleTitle}
          empty={<Alert severity="info">Add a rule first.</Alert>}
        >
          {rulePath => (
            <Stack spacing={2}>
              <BackendRefsEditor path={`${rulePath}.backendRefs`} namespace={namespace} />
              <HTTPRuleAdvancedFields path={rulePath} />
            </Stack>
          )}
        </ItemCards>
      ),
    },
  ];

  return (
    <WizardShell
      steps={steps}
      summary={<HTTPRouteSummary />}
      onReview={onReview}
      onRevealErrors={onRevealErrors}
      reviewLabel="Review and create"
    />
  );
}

/** Kinds that offer a step-by-step wizard in addition to the form. */
export const WIZARDS: Partial<Record<KindName, React.ComponentType<WizardProps>>> = {
  Gateway: GatewayWizard,
  HTTPRoute: HTTPRouteWizard,
};
