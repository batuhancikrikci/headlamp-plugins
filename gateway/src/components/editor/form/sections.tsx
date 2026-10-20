/**
 * Form sections shared by several kinds (and by the wizards, which show them one step at a time):
 * metadata, listeners, parent references, backends, matches, filters and policy targets.
 */
import { Icon } from '@iconify/react';
import {
  Autocomplete,
  Box,
  Button,
  Chip,
  Collapse,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import React from 'react';
import { ROUTE_KINDS } from '../../../resources/registry';
import {
  GATEWAY_GROUP,
  HTTPRouteFilter,
  HTTPRouteMatch,
  Listener,
  RouteGroupKind,
} from '../../../resources/types';
import { defaultRouteKinds } from '../../../utils/attachment';
import {
  describeFilter,
  describeHTTPMatch,
  describeListener,
  FILTER_LABELS,
} from '../../../utils/describe';
import {
  newBackendRef,
  newFilter,
  newHTTPMatch,
  newListener,
  newParentRef,
  withFilterType,
  withPathModifierType,
  withProtocol,
  withTLSMode,
} from '../../../utils/drafts';
import { asArray, asRecord, asString, getIn, isPlainObject, setIn } from '../../../utils/objects';
import {
  HTTP_METHODS,
  REDIRECT_STATUS_CODES,
  WELL_KNOWN_PROTOCOLS,
} from '../../../utils/validation';
import {
  ArrayInput,
  ComboInput,
  FieldGrid,
  FormSection,
  KeyValueInput,
  NumberInput,
  OptionalBlock,
  SelectInput,
  StringListInput,
  SwitchInput,
  TextInput,
} from './Fields';
import { useForm } from './FormContext';
import {
  BackendKindFields,
  BackendRefFields,
  NamespaceInput,
  ParentRefFields,
  SecretNameInput,
  WithNamespacedList,
} from './Pickers';

/** Button that reveals rarely needed fields; opens by itself when one of them has a value. */
export function Disclosure({
  title,
  children,
  hasContent,
}: {
  title: string;
  children: React.ReactNode;
  /** Whether any of the hidden fields is set; such a disclosure starts open. */
  hasContent?: boolean;
}) {
  const [open, setOpen] = React.useState(!!hasContent);
  return (
    <Box>
      <Button
        size="small"
        color="inherit"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        startIcon={<Icon icon={open ? 'mdi:chevron-down' : 'mdi:chevron-right'} />}
        sx={{ textTransform: 'none', color: 'text.secondary' }}
      >
        {title}
      </Button>
      <Collapse in={open} unmountOnExit>
        <Stack spacing={2} sx={{ pt: 1.5 }}>
          {children}
        </Stack>
      </Collapse>
    </Box>
  );
}

// ---------------------------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------------------------

export function MetadataSection({ namespaced }: { namespaced: boolean }) {
  const { mode, get } = useForm();
  const editing = mode === 'edit';
  const hasExtras =
    Object.keys(asRecord(get('metadata.labels'))).length > 0 ||
    Object.keys(asRecord(get('metadata.annotations'))).length > 0;
  return (
    <FormSection title="Metadata">
      <FieldGrid>
        <TextInput
          path="metadata.name"
          label="Name"
          required
          disabled={editing}
          help={editing ? 'The name cannot be changed' : 'Lowercase letters, digits and "-"'}
        />
        {namespaced && (
          <NamespaceInput
            path="metadata.namespace"
            required
            disabled={editing}
            help={editing ? 'The namespace cannot be changed' : undefined}
          />
        )}
      </FieldGrid>
      <Disclosure title="Labels and annotations" hasContent={hasExtras}>
        <KeyValueInput path="metadata.labels" label="Labels" addLabel="Add label" />
        <KeyValueInput path="metadata.annotations" label="Annotations" addLabel="Add annotation" />
      </Disclosure>
    </FormSection>
  );
}

// ---------------------------------------------------------------------------------------------
// Listeners
// ---------------------------------------------------------------------------------------------

const PROTOCOL_DESCRIPTIONS: Record<string, string> = {
  HTTP: 'Plain HTTP; serves HTTPRoute and GRPCRoute',
  HTTPS: 'HTTP over TLS, terminated at the Gateway',
  TLS: 'TLS by SNI; passthrough (TLSRoute) or terminated (TCPRoute)',
  TCP: 'Raw TCP; serves TCPRoute',
  UDP: 'UDP datagrams; serves UDPRoute',
};

function siblingNames(listeners: unknown): string[] {
  return asArray(listeners).map(listener => asString(asRecord(listener).name));
}

/** Name, protocol, port and hostname of one listener. */
export function ListenerBasicFields({ path }: { path: string }) {
  const { get, update } = useForm();
  const listener = asRecord(get(path));
  const listenersPath = path.slice(0, path.lastIndexOf('.'));
  const noHostname = listener.protocol === 'TCP' || listener.protocol === 'UDP';

  return (
    <FieldGrid minWidth={180}>
      <TextInput
        path={`${path}.name`}
        label="Name"
        required
        help="Routes select the listener by this name (sectionName)"
      />
      <SelectInput
        path={`${path}.protocol`}
        label="Protocol"
        required
        options={WELL_KNOWN_PROTOCOLS.map(protocol => ({
          value: protocol,
          description: PROTOCOL_DESCRIPTIONS[protocol],
        }))}
        onSelect={(protocol, previousProtocol) => {
          if (!protocol) return;
          // Adjust TLS, port and name to the new protocol in the same update.
          update(current =>
            setIn(
              current,
              path,
              withProtocol(getIn(current, path), protocol, {
                siblingNames: siblingNames(getIn(current, listenersPath)),
                previousProtocol,
              })
            )
          );
        }}
      />
      <NumberInput path={`${path}.port`} label="Port" required min={1} max={65535} />
      <TextInput
        path={`${path}.hostname`}
        label="Hostname"
        mono
        disabled={noHostname}
        placeholder={noHostname ? 'Not used' : 'Any (e.g. *.example.com)'}
        help={
          noHostname
            ? `${listener.protocol} listeners cannot match hostnames`
            : 'Optional. Limits the listener to this hostname; wildcards allowed'
        }
      />
    </FieldGrid>
  );
}

function needsTLS(listener: Record<string, unknown>): boolean {
  return listener.protocol === 'HTTPS' || listener.protocol === 'TLS';
}

/** TLS mode, certificates and options of one listener. Only for HTTPS and TLS listeners. */
export function ListenerTLSFields({ path, namespace }: { path: string; namespace?: string }) {
  const { get, update } = useForm();
  const listener = asRecord(get(path));
  const tls = asRecord(listener.tls);
  const mode = asString(tls.mode) || 'Terminate';

  if (!needsTLS(listener)) {
    return (
      <Typography variant="body2" color="text.secondary">
        {asString(listener.protocol) || 'This protocol'} listeners do not use TLS.
      </Typography>
    );
  }

  return (
    <Stack spacing={2}>
      <FieldGrid minWidth={220}>
        <SelectInput
          path={`${path}.tls.mode`}
          label="TLS mode"
          required
          disabled={listener.protocol === 'HTTPS'}
          options={[
            { value: 'Terminate', description: 'The Gateway decrypts traffic with a certificate' },
            { value: 'Passthrough', description: 'Encrypted traffic is forwarded to the backend' },
          ]}
          help={
            listener.protocol === 'HTTPS'
              ? 'HTTPS listeners always terminate TLS'
              : 'Passthrough requires TLSRoute; Terminate serves TCPRoute'
          }
          onSelect={next => {
            if (!next) return;
            update(current =>
              setIn(current, `${path}.tls`, withTLSMode(getIn(current, `${path}.tls`), next))
            );
          }}
        />
      </FieldGrid>
      {mode === 'Terminate' && (
        <Box>
          <Typography variant="subtitle2" gutterBottom>
            Certificates
          </Typography>
          <ArrayInput
            path={`${path}.tls.certificateRefs`}
            itemLabel="certificate"
            itemTitle={() => ''}
            dense
            keepEmpty
            newItem={() => ({ name: '' })}
            emptyText="No certificate selected."
            renderItem={(refPath, _index, ref) => {
              const refNamespace = asString(asRecord(ref).namespace);
              return (
                <Box>
                  <FieldGrid minWidth={200}>
                    <SecretNameInput
                      path={`${refPath}.name`}
                      namespace={refNamespace || namespace}
                      label="TLS secret"
                    />
                    <NamespaceInput
                      path={`${refPath}.namespace`}
                      label="Secret namespace"
                      placeholder={namespace || 'Same namespace'}
                    />
                  </FieldGrid>
                  {refNamespace && refNamespace !== namespace && (
                    <Typography variant="caption" color="text.secondary">
                      A ReferenceGrant in "{refNamespace}" must allow this Gateway to use the
                      secret.
                    </Typography>
                  )}
                </Box>
              );
            }}
          />
        </Box>
      )}
      <Disclosure title="TLS options" hasContent={Object.keys(asRecord(tls.options)).length > 0}>
        <KeyValueInput
          path={`${path}.tls.options`}
          label="Options"
          help="Implementation specific TLS settings, e.g. minimum TLS version"
          addLabel="Add option"
        />
      </Disclosure>
    </Stack>
  );
}

/** Which routes may attach to one listener: namespaces and kinds. */
export function ListenerAllowedRoutesFields({ path }: { path: string }) {
  const { get, set } = useForm();
  const listener = asRecord(get(path)) as unknown as Listener;
  const from = asString(get(`${path}.allowedRoutes.namespaces.from`));
  const kinds = asArray<RouteGroupKind>(get(`${path}.allowedRoutes.kinds`))
    .filter(isPlainObject)
    .map(kind => asString(kind.kind));
  const defaults = defaultRouteKinds(
    asString(listener.protocol),
    asString(asRecord(listener.tls).mode) || undefined
  );

  return (
    <Stack spacing={2}>
      <FieldGrid minWidth={240}>
        <SelectInput
          path={`${path}.allowedRoutes.namespaces.from`}
          label="Routes may come from"
          emptyLabel="Same namespace (default)"
          options={[
            { value: 'Same', description: 'Only routes in the namespace of this resource' },
            { value: 'All', description: 'Routes from every namespace' },
            { value: 'Selector', description: 'Routes from namespaces with matching labels' },
          ]}
          onSelect={next => {
            if (next !== 'Selector') set(`${path}.allowedRoutes.namespaces.selector`, undefined);
          }}
        />
        <Autocomplete<string, true, false, true>
          multiple
          freeSolo
          options={ROUTE_KINDS.filter(kind => !kinds.includes(kind))}
          value={kinds}
          onChange={(_event, next) =>
            set(
              `${path}.allowedRoutes.kinds`,
              next.length === 0 ? undefined : next.map(kind => ({ group: GATEWAY_GROUP, kind }))
            )
          }
          renderTags={(tags, getTagProps) =>
            tags.map((tag, index) => {
              const { key, ...tagProps } = getTagProps({ index });
              return <Chip key={key} size="small" label={tag} {...tagProps} />;
            })
          }
          renderInput={params => (
            <TextField
              {...params}
              label="Allowed route kinds"
              size="small"
              fullWidth
              helperText={
                kinds.length === 0
                  ? `Default for ${asString(listener.protocol) || 'the protocol'}: ${
                      defaults.join(', ') || 'implementation specific'
                    }`
                  : undefined
              }
            />
          )}
        />
      </FieldGrid>
      {from === 'Selector' && (
        <KeyValueInput
          path={`${path}.allowedRoutes.namespaces.selector.matchLabels`}
          label="Namespace labels"
          help="Namespaces carrying all of these labels may attach routes. Every namespace has the label kubernetes.io/metadata.name."
          addLabel="Add label"
        />
      )}
    </Stack>
  );
}

/** Full listener list editor (Gateway and ListenerSet forms). */
export function ListenersEditor({ path, namespace }: { path: string; namespace?: string }) {
  const { get } = useForm();
  return (
    <ArrayInput<Record<string, unknown>>
      path={path}
      itemLabel="listener"
      keepEmpty
      min={1}
      max={64}
      collapsible
      itemTitle={(listener, index) =>
        `${asString(listener?.name) || `Listener ${index + 1}`} — ${describeListener(
          listener as unknown as Listener
        )}`
      }
      newItem={() => newListener(get(path))}
      renderItem={itemPath => (
        <Stack spacing={2.5}>
          <ListenerBasicFields path={itemPath} />
          {needsTLS(asRecord(get(itemPath))) && (
            <Box>
              <Typography variant="subtitle2" gutterBottom>
                TLS
              </Typography>
              <ListenerTLSFields path={itemPath} namespace={namespace} />
            </Box>
          )}
          <Box>
            <Typography variant="subtitle2" gutterBottom>
              Allowed routes
            </Typography>
            <ListenerAllowedRoutesFields path={itemPath} />
          </Box>
        </Stack>
      )}
    />
  );
}

// ---------------------------------------------------------------------------------------------
// Routes: parents, hostnames, backends
// ---------------------------------------------------------------------------------------------

export function ParentRefsSection() {
  return (
    <FormSection
      title="Parents"
      description="The Gateways (or ListenerSets) that should serve this route. A route without a parent receives no traffic."
    >
      <ArrayInput
        path="spec.parentRefs"
        itemLabel="parent"
        max={32}
        itemTitle={(_ref, index) => `Parent ${index + 1}`}
        newItem={newParentRef}
        emptyText="No parent selected."
        renderItem={itemPath => <ParentRefFields path={itemPath} />}
      />
    </FormSection>
  );
}

export function HostnamesSection({ required }: { required?: boolean }) {
  return (
    <FormSection
      title="Hostnames"
      description={
        required
          ? 'SNI hostnames this route matches. At least one is required.'
          : 'Hostnames this route matches. Leave empty to match every hostname of the listener.'
      }
    >
      <StringListInput
        path="spec.hostnames"
        label="Hostnames"
        required={required}
        keepEmpty={required}
        placeholder="app.example.com, *.example.com"
        help="Press Enter after each hostname. A leading wildcard label (*.example.com) is allowed."
      />
    </FormSection>
  );
}

/** Backends of one rule. */
export function BackendRefsEditor({
  path,
  namespace,
  defaultPort = 80,
  min = 0,
}: {
  path: string;
  namespace?: string;
  defaultPort?: number;
  min?: number;
}) {
  return (
    <ArrayInput<Record<string, unknown>>
      path={path}
      itemLabel="backend"
      max={16}
      min={min}
      keepEmpty={min > 0}
      itemTitle={(ref, index) =>
        asString(ref?.name)
          ? `${asString(ref.kind) && ref.kind !== 'Service' ? `${ref.kind} ` : ''}${ref.name}${
              ref.port !== undefined ? `:${ref.port}` : ''
            }`
          : `Backend ${index + 1}`
      }
      newItem={() => newBackendRef(defaultPort)}
      emptyText="No backends."
      renderItem={(itemPath, _index, ref) => (
        <Stack spacing={1.5}>
          <BackendRefFields path={itemPath} namespace={namespace} />
          <Disclosure
            title="Backend kind (other than Service)"
            hasContent={!!asRecord(ref).kind || !!asRecord(ref).group}
          >
            <BackendKindFields path={itemPath} />
          </Disclosure>
        </Stack>
      )}
    />
  );
}

// ---------------------------------------------------------------------------------------------
// HTTP matches and filters
// ---------------------------------------------------------------------------------------------

const STRING_MATCH_OPTIONS = [
  { value: 'Exact', description: 'The value must be equal' },
  { value: 'RegularExpression', description: 'The value must match the expression' },
];

/** Header or query parameter matches: type, name, value. */
export function StringMatchRows({ path, itemLabel }: { path: string; itemLabel: string }) {
  return (
    <ArrayInput
      path={path}
      itemLabel={itemLabel}
      itemTitle={() => ''}
      dense
      max={16}
      newItem={() => ({ name: '', value: '' })}
      renderItem={itemPath => (
        <FieldGrid minWidth={140}>
          <TextInput path={`${itemPath}.name`} label="Name" required mono />
          <SelectInput
            path={`${itemPath}.type`}
            label="Match"
            emptyLabel="Exact (default)"
            options={STRING_MATCH_OPTIONS}
          />
          <TextInput path={`${itemPath}.value`} label="Value" required mono />
        </FieldGrid>
      )}
    />
  );
}

/** Matches of one HTTPRoute rule. */
export function HTTPMatchesEditor({ path }: { path: string }) {
  return (
    <ArrayInput<HTTPRouteMatch>
      path={path}
      itemLabel="match"
      max={64}
      itemTitle={match => describeHTTPMatch(match)}
      newItem={newHTTPMatch}
      emptyText="No matches: the rule applies to every request (PathPrefix /)."
      renderItem={itemPath => (
        <Stack spacing={2}>
          <FieldGrid minWidth={160}>
            <SelectInput
              path={`${itemPath}.path.type`}
              label="Path match"
              emptyLabel="PathPrefix (default)"
              options={[
                { value: 'PathPrefix', description: 'The path starts with the value (by segment)' },
                { value: 'Exact', description: 'The path equals the value' },
                { value: 'RegularExpression', description: 'Implementation specific regex' },
              ]}
            />
            <TextInput path={`${itemPath}.path.value`} label="Path" mono placeholder="/" />
            <SelectInput
              path={`${itemPath}.method`}
              label="Method"
              emptyLabel="Any method"
              options={HTTP_METHODS.map(value => ({ value }))}
            />
          </FieldGrid>
          <Box>
            <Typography variant="subtitle2" gutterBottom>
              Headers
            </Typography>
            <StringMatchRows path={`${itemPath}.headers`} itemLabel="header match" />
          </Box>
          <Box>
            <Typography variant="subtitle2" gutterBottom>
              Query parameters
            </Typography>
            <StringMatchRows path={`${itemPath}.queryParams`} itemLabel="query match" />
          </Box>
        </Stack>
      )}
    />
  );
}

function HeaderRows({ path, itemLabel }: { path: string; itemLabel: string }) {
  return (
    <ArrayInput
      path={path}
      itemLabel={itemLabel}
      itemTitle={() => ''}
      dense
      max={16}
      newItem={() => ({ name: '', value: '' })}
      renderItem={itemPath => (
        <FieldGrid minWidth={160}>
          <TextInput path={`${itemPath}.name`} label="Header" required mono />
          <TextInput path={`${itemPath}.value`} label="Value" required mono />
        </FieldGrid>
      )}
    />
  );
}

function HeaderModifierFields({ path }: { path: string }) {
  return (
    <Stack spacing={2}>
      <Box>
        <Typography variant="subtitle2">Set (replace)</Typography>
        <HeaderRows path={`${path}.set`} itemLabel="header to set" />
      </Box>
      <Box>
        <Typography variant="subtitle2">Add (append)</Typography>
        <HeaderRows path={`${path}.add`} itemLabel="header to add" />
      </Box>
      <StringListInput
        path={`${path}.remove`}
        label="Remove"
        placeholder="Header names"
        help="Press Enter after each header name"
      />
    </Stack>
  );
}

function PathModifierFields({ path }: { path: string }) {
  const { get, update } = useForm();
  const type = asString(get(`${path}.type`));
  return (
    <FieldGrid minWidth={200}>
      <SelectInput
        path={`${path}.type`}
        label="Path"
        emptyLabel="Keep the path"
        options={[
          { value: 'ReplaceFullPath', description: 'Replace the whole path' },
          { value: 'ReplacePrefixMatch', description: 'Replace the matched prefix only' },
        ]}
        onSelect={next =>
          update(current =>
            setIn(current, path, withPathModifierType(getIn(current, path), next || ''))
          )
        }
      />
      {type === 'ReplaceFullPath' && (
        <TextInput path={`${path}.replaceFullPath`} label="New path" required mono />
      )}
      {type === 'ReplacePrefixMatch' && (
        <TextInput
          path={`${path}.replacePrefixMatch`}
          label="New prefix"
          mono
          help="Needs exactly one PathPrefix match in the rule"
        />
      )}
    </FieldGrid>
  );
}

function FilterConfigFields({
  path,
  type,
  namespace,
}: {
  path: string;
  type: string;
  namespace?: string;
}) {
  switch (type) {
    case 'RequestHeaderModifier':
      return <HeaderModifierFields path={`${path}.requestHeaderModifier`} />;
    case 'ResponseHeaderModifier':
      return <HeaderModifierFields path={`${path}.responseHeaderModifier`} />;
    case 'RequestRedirect':
      return (
        <Stack spacing={2}>
          <FieldGrid minWidth={160}>
            <SelectInput
              path={`${path}.requestRedirect.scheme`}
              label="Scheme"
              emptyLabel="Keep the scheme"
              options={[{ value: 'https' }, { value: 'http' }]}
            />
            <TextInput
              path={`${path}.requestRedirect.hostname`}
              label="Hostname"
              mono
              placeholder="Keep the hostname"
            />
            <NumberInput
              path={`${path}.requestRedirect.port`}
              label="Port"
              min={1}
              max={65535}
              placeholder="Default for the scheme"
            />
            <SelectInput
              path={`${path}.requestRedirect.statusCode`}
              label="Status code"
              numeric
              emptyLabel="302 (default)"
              options={REDIRECT_STATUS_CODES.map(code => ({
                value: String(code),
                description:
                  code === 301 || code === 308 ? 'Permanent redirect' : 'Temporary redirect',
              }))}
            />
          </FieldGrid>
          <PathModifierFields path={`${path}.requestRedirect.path`} />
        </Stack>
      );
    case 'URLRewrite':
      return (
        <Stack spacing={2}>
          <FieldGrid minWidth={200}>
            <TextInput
              path={`${path}.urlRewrite.hostname`}
              label="Hostname"
              mono
              placeholder="Keep the hostname"
              help="Host header sent to the backend"
            />
          </FieldGrid>
          <PathModifierFields path={`${path}.urlRewrite.path`} />
        </Stack>
      );
    case 'RequestMirror':
      return (
        <Stack spacing={2}>
          <BackendRefFields
            path={`${path}.requestMirror.backendRef`}
            namespace={namespace}
            withWeight={false}
          />
          <FieldGrid minWidth={200}>
            <NumberInput
              path={`${path}.requestMirror.percent`}
              label="Percent of requests"
              min={0}
              max={100}
              placeholder="100"
              help="Share of requests copied to the mirror backend"
            />
          </FieldGrid>
        </Stack>
      );
    case 'CORS':
      return (
        <Stack spacing={2}>
          <StringListInput
            path={`${path}.cors.allowOrigins`}
            label="Allowed origins"
            placeholder="https://app.example.com or *"
          />
          <FieldGrid minWidth={220}>
            <StringListInput
              path={`${path}.cors.allowMethods`}
              label="Allowed methods"
              options={[...HTTP_METHODS, '*']}
            />
            <StringListInput path={`${path}.cors.allowHeaders`} label="Allowed request headers" />
            <StringListInput path={`${path}.cors.exposeHeaders`} label="Exposed response headers" />
            <NumberInput
              path={`${path}.cors.maxAge`}
              label="Max age (seconds)"
              min={1}
              placeholder="5"
              help="How long browsers cache the preflight response"
            />
          </FieldGrid>
          <SwitchInput path={`${path}.cors.allowCredentials`} label="Allow credentials" />
        </Stack>
      );
    case 'ExternalAuth':
      return (
        <Stack spacing={2}>
          <FieldGrid minWidth={200}>
            <SelectInput
              path={`${path}.externalAuth.protocol`}
              label="Protocol"
              required
              options={[
                { value: 'HTTP', description: 'HTTP authorization service' },
                { value: 'GRPC', description: 'Envoy ext_authz gRPC service' },
              ]}
            />
            <TextInput
              path={`${path}.externalAuth.http.path`}
              label="HTTP path prefix"
              mono
              placeholder="/"
            />
          </FieldGrid>
          <BackendRefFields
            path={`${path}.externalAuth.backendRef`}
            namespace={namespace}
            withWeight={false}
          />
        </Stack>
      );
    case 'ExtensionRef':
      return (
        <FieldGrid minWidth={160}>
          <TextInput path={`${path}.extensionRef.group`} label="Group" required mono />
          <TextInput path={`${path}.extensionRef.kind`} label="Kind" required />
          <TextInput path={`${path}.extensionRef.name`} label="Name" required />
        </FieldGrid>
      );
    default:
      return null;
  }
}

/** Filters of one rule (or one backend). */
export function FiltersEditor({
  path,
  types,
  namespace,
}: {
  path: string;
  types: string[];
  namespace?: string;
}) {
  const { update } = useForm();
  return (
    <ArrayInput<HTTPRouteFilter>
      path={path}
      itemLabel="filter"
      max={16}
      itemTitle={filter => describeFilter(filter)}
      newItem={() => newFilter(types[0])}
      emptyText="No filters: requests are forwarded unchanged."
      renderItem={(itemPath, _index, filter) => (
        <Stack spacing={2}>
          <FieldGrid minWidth={240}>
            <SelectInput
              path={`${itemPath}.type`}
              label="Filter type"
              required
              options={types.map(value => ({ value, label: FILTER_LABELS[value] || value }))}
              onSelect={next => {
                if (!next) return;
                // A filter may only carry the configuration of its own type.
                update(current =>
                  setIn(current, itemPath, withFilterType(getIn(current, itemPath), next))
                );
              }}
            />
          </FieldGrid>
          <FilterConfigFields
            path={itemPath}
            type={asString(asRecord(filter).type)}
            namespace={namespace}
          />
        </Stack>
      )}
    />
  );
}

export function SessionPersistenceFields({ path }: { path: string }) {
  return (
    <FieldGrid minWidth={180}>
      <SelectInput
        path={`${path}.type`}
        label="Type"
        emptyLabel="Cookie (default)"
        options={[{ value: 'Cookie' }, { value: 'Header' }]}
      />
      <TextInput path={`${path}.sessionName`} label="Session name" />
      <SelectInput
        path={`${path}.cookieConfig.lifetimeType`}
        label="Cookie lifetime"
        emptyLabel="Session (default)"
        options={[
          { value: 'Session', description: 'Deleted when the browser closes' },
          { value: 'Permanent', description: 'Kept until the absolute timeout' },
        ]}
      />
      <TextInput path={`${path}.absoluteTimeout`} label="Absolute timeout" placeholder="1h" />
      <TextInput path={`${path}.idleTimeout`} label="Idle timeout" placeholder="30m" />
    </FieldGrid>
  );
}

// ---------------------------------------------------------------------------------------------
// Policies
// ---------------------------------------------------------------------------------------------

/** Targets of a policy: Services (or other backends) in the policy's own namespace. */
export function TargetRefsEditor({
  namespace,
  withSection,
}: {
  namespace?: string;
  withSection?: boolean;
}) {
  return (
    <ArrayInput<Record<string, unknown>>
      path="spec.targetRefs"
      itemLabel="target"
      keepEmpty
      min={1}
      max={16}
      itemTitle={(target, index) =>
        asString(target?.name)
          ? `${asString(target.kind) || 'Service'} ${target.name}`
          : `Target ${index + 1}`
      }
      newItem={() => ({ group: '', kind: 'Service', name: '' })}
      renderItem={(itemPath, _index, target) => {
        const isService =
          (asString(asRecord(target).kind) || 'Service') === 'Service' &&
          asString(asRecord(target).group) === '';
        return (
          <WithNamespacedList kind="Service" namespace={isService ? namespace : undefined}>
            {services => (
              <FieldGrid minWidth={160}>
                <ComboInput
                  path={`${itemPath}.name`}
                  label={isService ? 'Service' : 'Name'}
                  required
                  options={(services || [])
                    .map(service => ({ value: service.metadata?.name || '' }))
                    .filter(option => option.value)}
                  help={`In namespace "${namespace || ''}" (policies target their own namespace)`}
                />
                <TextInput path={`${itemPath}.kind`} label="Kind" required />
                <TextInput
                  path={`${itemPath}.group`}
                  label="Group"
                  placeholder="(core)"
                  help="Empty for Services"
                />
                {withSection && (
                  <TextInput
                    path={`${itemPath}.sectionName`}
                    label="Port name"
                    placeholder="All ports"
                    help="Name of a Service port, to target only that port"
                  />
                )}
              </FieldGrid>
            )}
          </WithNamespacedList>
        );
      }}
    />
  );
}

/** How the Gateway validates the certificate of a backend (BackendTLSPolicy). */
export function BackendValidationFields({ path, namespace }: { path: string; namespace?: string }) {
  const { get, update } = useForm();
  const validation = asRecord(get(path));
  const usesRefs =
    asArray(validation.caCertificateRefs).length > 0 || !validation.wellKnownCACertificates;
  const source = validation.wellKnownCACertificates ? 'System' : usesRefs ? 'Refs' : 'System';

  return (
    <Stack spacing={2}>
      <FieldGrid minWidth={240}>
        <TextInput
          path={`${path}.hostname`}
          label="Hostname"
          required
          mono
          placeholder="backend.example.com"
          help="Sent as SNI and expected in the backend certificate"
        />
        <TextField
          select
          label="Trusted CA certificates"
          size="small"
          fullWidth
          value={source}
          onChange={event =>
            update(current => {
              const next: Record<string, unknown> = { ...asRecord(getIn(current, path)) };
              if (event.target.value === 'System') {
                next.wellKnownCACertificates = 'System';
                delete next.caCertificateRefs;
              } else {
                delete next.wellKnownCACertificates;
                next.caCertificateRefs = [{ group: '', kind: 'ConfigMap', name: '' }];
              }
              return setIn(current, path, next);
            })
          }
          helperText="Exactly one source of CA certificates must be chosen"
        >
          <MenuItem value="System">System trust store (well-known CAs)</MenuItem>
          <MenuItem value="Refs">CA certificates from ConfigMaps or Secrets</MenuItem>
        </TextField>
      </FieldGrid>
      {source === 'Refs' && (
        <Box>
          <Typography variant="subtitle2" gutterBottom>
            CA certificate references
          </Typography>
          <ArrayInput
            path={`${path}.caCertificateRefs`}
            itemLabel="CA reference"
            itemTitle={() => ''}
            dense
            keepEmpty
            max={8}
            newItem={() => ({ group: '', kind: 'ConfigMap', name: '' })}
            renderItem={(itemPath, _index, ref) => {
              const kind = asString(asRecord(ref).kind) || 'ConfigMap';
              return (
                <WithNamespacedList
                  kind={kind === 'Secret' ? 'Secret' : 'ConfigMap'}
                  namespace={kind === 'Secret' || kind === 'ConfigMap' ? namespace : undefined}
                >
                  {items => (
                    <FieldGrid minWidth={160}>
                      <SelectInput
                        path={`${itemPath}.kind`}
                        label="Kind"
                        required
                        options={[
                          { value: 'ConfigMap', description: 'Key ca.crt holds the certificate' },
                          { value: 'Secret' },
                        ]}
                      />
                      <ComboInput
                        path={`${itemPath}.name`}
                        label="Name"
                        required
                        options={(items || [])
                          .map(item => ({ value: item.metadata?.name || '' }))
                          .filter(option => option.value)}
                      />
                    </FieldGrid>
                  )}
                </WithNamespacedList>
              );
            }}
          />
        </Box>
      )}
      <Disclosure
        title="Subject alternative names"
        hasContent={asArray(validation.subjectAltNames).length > 0}
      >
        <Typography variant="body2" color="text.secondary">
          When set, the certificate must contain one of these names instead of the hostname.
        </Typography>
        <ArrayInput
          path={`${path}.subjectAltNames`}
          itemLabel="subject alt name"
          itemTitle={() => ''}
          dense
          max={5}
          newItem={() => ({ type: 'Hostname', hostname: '' })}
          renderItem={(itemPath, _index, san) => {
            const type = asString(asRecord(san).type);
            return (
              <FieldGrid minWidth={160}>
                <SelectInput
                  path={`${itemPath}.type`}
                  label="Type"
                  required
                  options={[{ value: 'Hostname' }, { value: 'URI' }]}
                  onSelect={next =>
                    update(current =>
                      setIn(
                        current,
                        itemPath,
                        next === 'URI'
                          ? { type: 'URI', uri: '' }
                          : { type: 'Hostname', hostname: '' }
                      )
                    )
                  }
                />
                {type === 'URI' ? (
                  <TextInput
                    path={`${itemPath}.uri`}
                    label="URI"
                    required
                    mono
                    placeholder="spiffe://example.com/backend"
                  />
                ) : (
                  <TextInput path={`${itemPath}.hostname`} label="Hostname" required mono />
                )}
              </FieldGrid>
            );
          }}
        />
      </Disclosure>
    </Stack>
  );
}

/** Optional reference to implementation specific parameters (GatewayClass). */
export function ParametersRefBlock({ path }: { path: string }) {
  return (
    <OptionalBlock
      path={path}
      label="Reference a parameters object"
      help="Implementation specific configuration, e.g. an EnvoyProxy resource for Envoy Gateway."
      initial={() => ({ group: '', kind: '', name: '' })}
    >
      <FieldGrid minWidth={160}>
        <TextInput
          path={`${path}.group`}
          label="Group"
          required
          mono
          placeholder="gateway.envoyproxy.io"
        />
        <TextInput path={`${path}.kind`} label="Kind" required placeholder="EnvoyProxy" />
        <TextInput path={`${path}.name`} label="Name" required />
        <NamespaceInput
          path={`${path}.namespace`}
          label="Namespace"
          help="Required when the parameters object is namespaced"
        />
      </FieldGrid>
    </OptionalBlock>
  );
}
