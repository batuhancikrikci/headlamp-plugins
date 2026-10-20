/**
 * The guided form of every kind. Each form is a composition of sections that edit the shared
 * resource object through the form context; none of them holds resource state of its own.
 */
import { Alert, Box, Stack, Typography } from '@mui/material';
import React from 'react';
import { KindName } from '../../resources/registry';
import { GRPCRouteMatch, HTTPRouteRule } from '../../resources/types';
import { describeGRPCMatch, describeHTTPMatch } from '../../utils/describe';
import {
  GRANT_FROM_KINDS,
  GRANT_TO_KINDS,
  grantGroupFor,
  newGRPCRule,
  newHTTPRule,
} from '../../utils/drafts';
import { asArray, asRecord, asString, getIn, setIn } from '../../utils/objects';
import { GRPC_FILTER_TYPES, HTTP_FILTER_TYPES } from '../../utils/validation';
import {
  ArrayInput,
  ComboInput,
  FieldGrid,
  FormSection,
  KeyValueInput,
  NumberInput,
  OptionalBlock,
  SelectInput,
  TextInput,
} from './form/Fields';
import { useForm } from './form/FormContext';
import {
  ControllerNameInput,
  GatewayClassInput,
  ListenerSetParentFields,
  NamespaceInput,
} from './form/Pickers';
import {
  BackendRefsEditor,
  BackendValidationFields,
  Disclosure,
  FiltersEditor,
  HostnamesSection,
  HTTPMatchesEditor,
  ListenersEditor,
  MetadataSection,
  ParametersRefBlock,
  ParentRefsSection,
  SessionPersistenceFields,
  StringMatchRows,
  TargetRefsEditor,
} from './form/sections';

function useNamespace(): string | undefined {
  const { value } = useForm();
  return value.metadata?.namespace;
}

// ---------------------------------------------------------------------------------------------
// GatewayClass
// ---------------------------------------------------------------------------------------------

function GatewayClassForm() {
  const { mode } = useForm();
  return (
    <>
      <MetadataSection namespaced={false} />
      <FormSection
        title="Controller"
        description="A GatewayClass hands every Gateway that names it to one controller."
      >
        <ControllerNameInput path="spec.controllerName" disabled={mode === 'edit'} />
        <TextInput
          path="spec.description"
          label="Description"
          help="Optional, at most 64 characters"
        />
        <ParametersRefBlock path="spec.parametersRef" />
      </FormSection>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Gateway, ListenerSet
// ---------------------------------------------------------------------------------------------

export function GatewayAdvancedFields() {
  const { get } = useForm();
  const hasContent =
    asArray(get('spec.addresses')).length > 0 ||
    get('spec.infrastructure') !== undefined ||
    get('spec.allowedListeners') !== undefined;
  return (
    <Disclosure title="Addresses, infrastructure and listener sets" hasContent={hasContent}>
      <Box>
        <Typography variant="subtitle2" gutterBottom>
          Requested addresses
        </Typography>
        <ArrayInput
          path="spec.addresses"
          itemLabel="address"
          itemTitle={() => ''}
          dense
          max={16}
          newItem={() => ({ type: 'IPAddress', value: '' })}
          emptyText="None: the controller assigns an address."
          renderItem={itemPath => (
            <FieldGrid minWidth={180}>
              <SelectInput
                path={`${itemPath}.type`}
                label="Type"
                emptyLabel="IPAddress (default)"
                options={[{ value: 'IPAddress' }, { value: 'Hostname' }]}
              />
              <TextInput path={`${itemPath}.value`} label="Value" mono />
            </FieldGrid>
          )}
        />
      </Box>
      <KeyValueInput
        path="spec.infrastructure.labels"
        label="Infrastructure labels"
        help="Applied to the resources the controller creates for this Gateway (Deployment, Service)."
        addLabel="Add label"
      />
      <KeyValueInput
        path="spec.infrastructure.annotations"
        label="Infrastructure annotations"
        help="For example cloud load balancer annotations for the generated Service."
        addLabel="Add annotation"
      />
      <FieldGrid minWidth={260}>
        <SelectInput
          path="spec.allowedListeners.namespaces.from"
          label="Accept ListenerSets from"
          emptyLabel="None (default)"
          options={[
            { value: 'Same', description: 'ListenerSets in the namespace of this Gateway' },
            { value: 'All', description: 'ListenerSets from every namespace' },
            { value: 'Selector', description: 'Namespaces with matching labels' },
          ]}
          help="Lets other teams add listeners to this Gateway with a ListenerSet"
        />
      </FieldGrid>
      {get('spec.allowedListeners.namespaces.from') === 'Selector' && (
        <KeyValueInput
          path="spec.allowedListeners.namespaces.selector.matchLabels"
          label="Namespace labels"
          addLabel="Add label"
        />
      )}
    </Disclosure>
  );
}

function GatewayForm() {
  const namespace = useNamespace();
  return (
    <>
      <MetadataSection namespaced />
      <FormSection
        title="Gateway class"
        description="The class decides which controller provisions and configures this Gateway."
      >
        <GatewayClassInput path="spec.gatewayClassName" />
      </FormSection>
      <FormSection
        title="Listeners"
        description="Each listener opens a port for one protocol and decides which routes may attach to it."
      >
        <ListenersEditor path="spec.listeners" namespace={namespace} />
      </FormSection>
      <FormSection title="Advanced">
        <GatewayAdvancedFields />
      </FormSection>
    </>
  );
}

function ListenerSetForm() {
  const namespace = useNamespace();
  return (
    <>
      <MetadataSection namespaced />
      <FormSection
        title="Parent Gateway"
        description="The Gateway these listeners are added to. The Gateway must allow ListenerSets from this namespace (spec.allowedListeners)."
      >
        <ListenerSetParentFields path="spec.parentRef" />
      </FormSection>
      <FormSection title="Listeners">
        <ListenersEditor path="spec.listeners" namespace={namespace} />
      </FormSection>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------------------------

/** Timeouts, retries and session persistence of one HTTPRoute rule. */
export function HTTPRuleAdvancedFields({ path }: { path: string }) {
  const { get } = useForm();
  const rule = asRecord(get(path));
  return (
    <Disclosure
      title="Timeouts, retries and session persistence"
      hasContent={!!rule.timeouts || !!rule.retry || !!rule.sessionPersistence}
    >
      <FieldGrid minWidth={200}>
        <TextInput
          path={`${path}.timeouts.request`}
          label="Request timeout"
          placeholder="e.g. 30s"
          help="Time allowed for the whole request, including retries"
        />
        <TextInput
          path={`${path}.timeouts.backendRequest`}
          label="Backend request timeout"
          placeholder="e.g. 10s"
          help="Time allowed for one attempt to the backend"
        />
        <NumberInput
          path={`${path}.retry.attempts`}
          label="Retry attempts"
          min={1}
          help="Experimental channel"
        />
        <TextInput path={`${path}.retry.backoff`} label="Retry backoff" placeholder="e.g. 250ms" />
      </FieldGrid>
      <OptionalBlock
        path={`${path}.sessionPersistence`}
        label="Session persistence"
        help="Keep a client on the same backend (experimental channel)."
        initial={() => ({ type: 'Cookie' })}
      >
        <SessionPersistenceFields path={`${path}.sessionPersistence`} />
      </OptionalBlock>
    </Disclosure>
  );
}

function ruleTitle(rule: HTTPRouteRule, index: number, describe: (match: unknown) => string) {
  const name = asString(asRecord(rule).name);
  const matches = asArray(asRecord(rule).matches);
  const summary =
    matches.length === 0
      ? 'all requests'
      : matches.length === 1
      ? describe(matches[0])
      : `${describe(matches[0])} +${matches.length - 1} more`;
  return `Rule ${index + 1}${name ? ` (${name})` : ''}: ${summary}`;
}

export function httpRuleTitle(rule: HTTPRouteRule, index: number): string {
  return ruleTitle(rule, index, match => describeHTTPMatch(match as never));
}

function HTTPRouteForm() {
  const namespace = useNamespace();
  return (
    <>
      <MetadataSection namespaced />
      <ParentRefsSection />
      <HostnamesSection />
      <FormSection
        title="Rules"
        description="Rules are evaluated by specificity: the most specific match wins, regardless of order."
      >
        <ArrayInput<HTTPRouteRule>
          path="spec.rules"
          itemLabel="rule"
          keepEmpty
          min={1}
          max={16}
          collapsible
          itemTitle={httpRuleTitle}
          newItem={newHTTPRule}
          renderItem={rulePath => (
            <Stack spacing={2.5}>
              <FieldGrid>
                <TextInput
                  path={`${rulePath}.name`}
                  label="Rule name"
                  help="Optional; lets policies target this rule"
                />
              </FieldGrid>
              <Box>
                <Typography variant="subtitle2" gutterBottom>
                  Matches
                </Typography>
                <HTTPMatchesEditor path={`${rulePath}.matches`} />
              </Box>
              <Box>
                <Typography variant="subtitle2" gutterBottom>
                  Filters
                </Typography>
                <FiltersEditor
                  path={`${rulePath}.filters`}
                  types={HTTP_FILTER_TYPES}
                  namespace={namespace}
                />
              </Box>
              <Box>
                <Typography variant="subtitle2" gutterBottom>
                  Backends
                </Typography>
                <BackendRefsEditor path={`${rulePath}.backendRefs`} namespace={namespace} />
              </Box>
              <HTTPRuleAdvancedFields path={rulePath} />
            </Stack>
          )}
        />
      </FormSection>
    </>
  );
}

function GRPCMatchesEditor({ path }: { path: string }) {
  return (
    <ArrayInput<GRPCRouteMatch>
      path={path}
      itemLabel="match"
      max={64}
      itemTitle={match => describeGRPCMatch(match)}
      newItem={() => ({ method: { service: '', method: '' } })}
      emptyText="No matches: the rule applies to every gRPC call."
      renderItem={itemPath => (
        <Stack spacing={2}>
          <FieldGrid minWidth={180}>
            <TextInput
              path={`${itemPath}.method.service`}
              label="Service"
              mono
              placeholder="package.v1.Service"
            />
            <TextInput
              path={`${itemPath}.method.method`}
              label="Method"
              mono
              placeholder="GetItem"
            />
            <SelectInput
              path={`${itemPath}.method.type`}
              label="Match"
              emptyLabel="Exact (default)"
              options={[{ value: 'Exact' }, { value: 'RegularExpression' }]}
            />
          </FieldGrid>
          <Box>
            <Typography variant="subtitle2" gutterBottom>
              Headers
            </Typography>
            <StringMatchRows path={`${itemPath}.headers`} itemLabel="header match" />
          </Box>
        </Stack>
      )}
    />
  );
}

function GRPCRouteForm() {
  const namespace = useNamespace();
  return (
    <>
      <MetadataSection namespaced />
      <ParentRefsSection />
      <HostnamesSection />
      <FormSection title="Rules">
        <ArrayInput<HTTPRouteRule>
          path="spec.rules"
          itemLabel="rule"
          keepEmpty
          min={1}
          max={16}
          collapsible
          itemTitle={(rule, index) =>
            ruleTitle(rule, index, match => describeGRPCMatch(match as never))
          }
          newItem={newGRPCRule}
          renderItem={rulePath => (
            <Stack spacing={2.5}>
              <FieldGrid>
                <TextInput path={`${rulePath}.name`} label="Rule name" help="Optional" />
              </FieldGrid>
              <Box>
                <Typography variant="subtitle2" gutterBottom>
                  Matches
                </Typography>
                <GRPCMatchesEditor path={`${rulePath}.matches`} />
              </Box>
              <Box>
                <Typography variant="subtitle2" gutterBottom>
                  Filters
                </Typography>
                <FiltersEditor
                  path={`${rulePath}.filters`}
                  types={GRPC_FILTER_TYPES}
                  namespace={namespace}
                />
              </Box>
              <Box>
                <Typography variant="subtitle2" gutterBottom>
                  Backends
                </Typography>
                <BackendRefsEditor
                  path={`${rulePath}.backendRefs`}
                  namespace={namespace}
                  defaultPort={50051}
                />
              </Box>
            </Stack>
          )}
        />
      </FormSection>
    </>
  );
}

const L4_DEFAULT_PORTS: Record<string, number> = { TLSRoute: 443, TCPRoute: 8080, UDPRoute: 53 };

function L4RouteForm({ kind }: { kind: 'TLSRoute' | 'TCPRoute' | 'UDPRoute' }) {
  const namespace = useNamespace();
  return (
    <>
      <MetadataSection namespaced />
      <ParentRefsSection />
      {kind === 'TLSRoute' && <HostnamesSection required />}
      <FormSection
        title="Backends"
        description={
          kind === 'TLSRoute'
            ? 'Connections whose SNI matches a hostname are forwarded to these backends.'
            : `Every ${
                kind === 'UDPRoute' ? 'datagram' : 'connection'
              } arriving on the listener is forwarded to these backends.`
        }
      >
        <FieldGrid>
          <TextInput path="spec.rules.0.name" label="Rule name" help="Optional" />
        </FieldGrid>
        <BackendRefsEditor
          path="spec.rules.0.backendRefs"
          namespace={namespace}
          defaultPort={L4_DEFAULT_PORTS[kind]}
          min={1}
        />
      </FormSection>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// ReferenceGrant
// ---------------------------------------------------------------------------------------------

function ReferenceGrantForm() {
  const { update } = useForm();
  const namespace = useNamespace();

  /** Selecting a well-known kind also sets its API group. */
  const syncGroup = (itemPath: string, side: 'from' | 'to') => (kind: string) => {
    const group = grantGroupFor(kind, side);
    if (group !== undefined) {
      update(current => setIn(current, `${itemPath}.group`, group));
    }
  };
  const ensureGroup = (itemPath: string) => {
    // The core group is an empty string, which must be present in the object.
    update(current =>
      getIn(current, `${itemPath}.group`) === undefined
        ? setIn(current, `${itemPath}.group`, '')
        : current
    );
  };

  return (
    <>
      <MetadataSection namespaced />
      <Alert severity="info" sx={{ mb: 3 }}>
        A ReferenceGrant lives in the namespace of the objects being referenced
        {namespace ? ` ("${namespace}")` : ''} and lists who may reference them.
      </Alert>
      <FormSection
        title="From: who may reference"
        description="Kinds and namespaces of the resources that are allowed to reference objects in this namespace."
      >
        <ArrayInput
          path="spec.from"
          itemLabel="source"
          itemTitle={() => ''}
          dense
          keepEmpty
          min={1}
          max={16}
          newItem={() => ({ group: GRANT_FROM_KINDS[0].group, kind: 'HTTPRoute', namespace: '' })}
          renderItem={itemPath => (
            <FieldGrid minWidth={160}>
              <ComboInput
                path={`${itemPath}.kind`}
                label="Kind"
                required
                options={GRANT_FROM_KINDS.map(entry => ({ value: entry.kind }))}
                onSelect={syncGroup(itemPath, 'from')}
              />
              <NamespaceInput path={`${itemPath}.namespace`} label="From namespace" required />
              <TextInput
                path={`${itemPath}.group`}
                label="Group"
                mono
                placeholder="(core)"
                help="Set automatically for Gateway API kinds"
              />
            </FieldGrid>
          )}
        />
      </FormSection>
      <FormSection
        title="To: what may be referenced"
        description="Kinds (and optionally names) of the objects in this namespace that may be referenced."
      >
        <ArrayInput
          path="spec.to"
          itemLabel="target"
          itemTitle={() => ''}
          dense
          keepEmpty
          min={1}
          max={16}
          newItem={() => ({ group: '', kind: 'Service' })}
          renderItem={itemPath => (
            <FieldGrid minWidth={160}>
              <ComboInput
                path={`${itemPath}.kind`}
                label="Kind"
                required
                options={GRANT_TO_KINDS.map(entry => ({ value: entry.kind }))}
                onSelect={kind => {
                  syncGroup(itemPath, 'to')(kind);
                  ensureGroup(itemPath);
                }}
              />
              <TextInput
                path={`${itemPath}.name`}
                label="Name"
                placeholder="Any"
                help="Empty allows every object of this kind"
              />
              <TextInput
                path={`${itemPath}.group`}
                label="Group"
                mono
                placeholder="(core)"
                help="Empty for Service, Secret and ConfigMap"
              />
            </FieldGrid>
          )}
        />
      </FormSection>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Policies
// ---------------------------------------------------------------------------------------------

function BackendTLSPolicyForm() {
  const namespace = useNamespace();
  const { get } = useForm();
  return (
    <>
      <MetadataSection namespaced />
      <FormSection
        title="Targets"
        description="The Services whose connections from the Gateway must use TLS."
      >
        <TargetRefsEditor namespace={namespace} withSection />
      </FormSection>
      <FormSection
        title="TLS validation"
        description="How the Gateway verifies the certificate presented by the backend."
      >
        <BackendValidationFields path="spec.validation" namespace={namespace} />
      </FormSection>
      <FormSection title="Advanced">
        <Disclosure
          title="Implementation specific options"
          hasContent={Object.keys(asRecord(get('spec.options'))).length > 0}
        >
          <KeyValueInput path="spec.options" label="Options" addLabel="Add option" />
        </Disclosure>
      </FormSection>
    </>
  );
}

/** The guided form of every kind. */
export const FORMS: Record<KindName, React.ComponentType> = {
  GatewayClass: GatewayClassForm,
  Gateway: GatewayForm,
  ListenerSet: ListenerSetForm,
  HTTPRoute: HTTPRouteForm,
  GRPCRoute: GRPCRouteForm,
  TLSRoute: () => <L4RouteForm kind="TLSRoute" />,
  TCPRoute: () => <L4RouteForm kind="TCPRoute" />,
  UDPRoute: () => <L4RouteForm kind="UDPRoute" />,
  ReferenceGrant: ReferenceGrantForm,
  BackendTLSPolicy: BackendTLSPolicyForm,
};
