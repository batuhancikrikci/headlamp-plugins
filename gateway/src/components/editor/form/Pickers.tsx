/**
 * Form fields that offer the objects existing in the cluster: namespaces, GatewayClasses,
 * Gateways and their listeners, Services and their ports, the other backend kinds the cluster
 * serves (Backend, InferencePool) and their objects, Secrets.
 *
 * Every picker degrades to plain text input when the objects cannot be listed (missing
 * permission), so a restricted user can still fill in the form.
 */
import { K8s } from '@kinvolk/headlamp-plugin/lib';
import type { KubeObjectClass } from '@kinvolk/headlamp-plugin/lib/K8s/cluster';
import { KubeObject } from '@kinvolk/headlamp-plugin/lib/k8s/cluster';
import { Alert, Box, MenuItem, TextField, Typography } from '@mui/material';
import React from 'react';
import { useGatewayApiData } from '../../../data/GatewayApiData';
import { useBackendKinds, useBackendObjects } from '../../../discovery/backendDiscovery';
import {
  BackendKind,
  backendKindKey,
  describeBackendObject,
  isKubernetesGroup,
} from '../../../discovery/backendKinds';
import { GATEWAY_GROUP, KubeJson, Listener } from '../../../resources/types';
import { evaluateAttachment, listenerSetAllowed } from '../../../utils/attachment';
import { describeListener } from '../../../utils/describe';
import { asArray, asRecord, asString, getIn, isPlainObject, setIn } from '../../../utils/objects';
import { parseParentText, resolveParentRef } from '../../../utils/refs';
import { controllerLabel, KNOWN_CONTROLLERS } from '../../../utils/templates';
import {
  Combo,
  ComboInput,
  FieldGrid,
  NumberInput,
  Option,
  SelectInput,
  TextInput,
} from './Fields';
import { useFieldIssue, useForm } from './FormContext';

type CoreListKind = 'Service' | 'Secret' | 'ConfigMap' | 'Namespace';

function coreClass(kind: CoreListKind): KubeObjectClass {
  return (K8s.ResourceClasses as Record<string, KubeObjectClass>)[kind];
}

function ListLoader({
  kind,
  namespace,
  children,
}: {
  kind: CoreListKind;
  namespace?: string;
  children: (items: KubeJson[] | null) => React.ReactNode;
}) {
  const [items, error] = coreClass(kind).useList(namespace ? { namespace } : undefined) as [
    KubeObject[] | null,
    unknown
  ];
  const json = React.useMemo(
    () => (items && !error ? items.map(item => item.jsonData as KubeJson) : null),
    [items, error]
  );
  return <>{children(json)}</>;
}

/**
 * Lists core objects of one namespace and passes them to its children. Nothing is listed while
 * the namespace is unknown, so secrets are never fetched cluster-wide.
 */
export function WithNamespacedList({
  kind,
  namespace,
  children,
}: {
  kind: Exclude<CoreListKind, 'Namespace'>;
  namespace?: string;
  children: (items: KubeJson[] | null) => React.ReactNode;
}) {
  if (!namespace) return <>{children(null)}</>;
  return (
    <ListLoader kind={kind} namespace={namespace}>
      {children}
    </ListLoader>
  );
}

function names(items: KubeJson[] | null): Option[] {
  return (items || [])
    .map(item => item.metadata?.name || '')
    .filter(Boolean)
    .sort()
    .map(value => ({ value }));
}

/** Namespace input with the namespaces of the cluster as suggestions. */
export function NamespaceInput({
  path,
  label = 'Namespace',
  required,
  help,
  disabled,
  placeholder,
}: {
  path: string;
  label?: string;
  required?: boolean;
  help?: React.ReactNode;
  disabled?: boolean;
  placeholder?: string;
}) {
  return (
    <ListLoader kind="Namespace">
      {items => (
        <ComboInput
          path={path}
          label={label}
          required={required}
          help={help}
          disabled={disabled}
          placeholder={placeholder}
          options={names(items)}
        />
      )}
    </ListLoader>
  );
}

/** GatewayClass selector listing the classes of the cluster with their controller. */
export function GatewayClassInput({ path }: { path: string }) {
  const data = useGatewayApiData();
  const classes = data.json('GatewayClass') || [];
  const options: Option[] = classes.map(cls => {
    const controller = asString(asRecord(cls.spec).controllerName);
    const description = asString(asRecord(cls.spec).description);
    return {
      value: cls.metadata?.name || '',
      description: [controllerLabel(controller) || controller, description]
        .filter(Boolean)
        .join(' — '),
    };
  });
  return (
    <ComboInput
      path={path}
      label="Gateway class"
      required
      options={options}
      loading={data.list('GatewayClass') === null}
      help={
        options.length === 0 && data.list('GatewayClass') !== null
          ? 'No GatewayClass exists yet: install a controller or create a class first.'
          : 'The class selects the controller that implements this Gateway.'
      }
    />
  );
}

/** Controller name input with the well-known implementations as suggestions. */
export function ControllerNameInput({ path, disabled }: { path: string; disabled?: boolean }) {
  const data = useGatewayApiData();
  const inUse = (data.json('GatewayClass') || [])
    .map(cls => asString(asRecord(cls.spec).controllerName))
    .filter(Boolean);
  const options: Option[] = [
    ...KNOWN_CONTROLLERS.map(c => ({ value: c.name, description: c.label })),
    ...[...new Set(inUse)]
      .filter(name => !KNOWN_CONTROLLERS.some(c => c.name === name))
      .map(name => ({ value: name, description: 'Used by an existing class' })),
  ];
  return (
    <ComboInput
      path={path}
      label="Controller name"
      required
      disabled={disabled}
      options={options}
      placeholder="example.com/gateway-controller"
      help={
        disabled
          ? 'The controller name cannot be changed after creation.'
          : 'Domain-prefixed name of the controller that manages Gateways of this class.'
      }
    />
  );
}

/** Secret name input listing the TLS secrets of a namespace. */
export function SecretNameInput({
  path,
  namespace,
  label = 'Secret',
  tlsOnly = true,
}: {
  path: string;
  namespace?: string;
  label?: string;
  tlsOnly?: boolean;
}) {
  return (
    <WithNamespacedList kind="Secret" namespace={namespace}>
      {items => {
        const candidates = (items || []).filter(
          secret => !tlsOnly || (secret as { type?: string }).type === 'kubernetes.io/tls'
        );
        return (
          <ComboInput
            path={path}
            label={label}
            required
            options={names(candidates)}
            help={
              items === null
                ? undefined
                : candidates.length === 0
                ? `No ${tlsOnly ? 'TLS ' : ''}secret found in namespace "${namespace}".`
                : undefined
            }
          />
        );
      }}
    </WithNamespacedList>
  );
}

interface ServicePort {
  port?: number;
  name?: string;
  protocol?: string;
}

/** Note shown for backend kinds that only some Gateway implementations resolve. */
function implementationNote(group: string, kind: string): string | undefined {
  if (!kind || isKubernetesGroup(group)) return undefined;
  const envoy =
    group === 'gateway.envoyproxy.io' && kind === 'Backend'
      ? ' Envoy Gateway serves it only when extensionApis.enableBackend is true in its configuration.'
      : '';
  return (
    `${kind} (${group}) is specific to one Gateway implementation. Only implementations that ` +
    `support it resolve the reference; others report ResolvedRefs: False (InvalidKind) on the ` +
    `route.${envoy}`
  );
}

/**
 * Kind of a backend: Service or one of the backend kinds served by the cluster (Backend of any
 * implementation, InferencePool). Selecting one sets the group and kind of the reference.
 */
function BackendKindSelect({ path, kinds }: { path: string; kinds: BackendKind[] }) {
  const { get, update } = useForm();
  const ref = asRecord(get(path));
  const group = asString(ref.group);
  const kind = asString(ref.kind) || 'Service';
  const current = backendKindKey(group, kind);
  const options: Option[] = [
    { value: backendKindKey('', 'Service'), label: 'Service' },
    ...kinds.map(k => ({
      value: backendKindKey(k.group, k.kind),
      label: k.kind,
      description: `${k.group}/${k.version}`,
    })),
  ];
  // A kind typed in by hand (or in YAML) that the cluster does not serve stays visible.
  if (!options.some(option => option.value === current)) {
    options.push({ value: current, label: kind, description: group || 'core' });
  }

  const select = (value: string) => {
    if (value === current) return;
    const picked = kinds.find(k => backendKindKey(k.group, k.kind) === value);
    update(json => {
      const next: Record<string, unknown> = { ...asRecord(getIn(json, path)), name: '' };
      if (picked) {
        next.group = picked.group;
        next.kind = picked.kind;
      } else {
        delete next.group;
        delete next.kind;
      }
      return setIn(json, path, next);
    });
  };

  return (
    <TextField
      select
      label="Kind"
      value={current}
      onChange={event => select(event.target.value)}
      size="small"
      fullWidth
    >
      {options.map(option => (
        <MenuItem key={option.value} value={option.value}>
          <Box>
            {option.label ?? option.value}
            {option.description && (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                {option.description}
              </Typography>
            )}
          </Box>
        </MenuItem>
      ))}
    </TextField>
  );
}

/**
 * Fields of a backend reference: kind, name, namespace, port and optionally the weight. Selecting
 * a Service offers its ports; the other kinds served by the cluster offer their objects.
 */
export function BackendRefFields({
  path,
  namespace,
  withWeight = true,
  crossNamespaceHint = true,
}: {
  path: string;
  /** Namespace of the route; the default namespace of the backend. */
  namespace?: string;
  withWeight?: boolean;
  crossNamespaceHint?: boolean;
}) {
  const { get, set } = useForm();
  const ref = asRecord(get(path));
  const group = asString(ref.group);
  const kind = asString(ref.kind) || 'Service';
  const isService = kind === 'Service' && group === '';
  const backendNamespace = asString(ref.namespace) || namespace;
  const crossNamespace = !!ref.namespace && ref.namespace !== namespace;
  const portIssue = useFieldIssue(`${path}.port`);
  const backendKinds = useBackendKinds();
  const backendKind = isService
    ? undefined
    : backendKinds.find(k => k.group === group && k.kind === kind);
  const backendObjects = useBackendObjects(backendKind, backendNamespace);
  const note = implementationNote(group, asString(ref.kind));

  return (
    <Box>
      <WithNamespacedList kind="Service" namespace={isService ? backendNamespace : undefined}>
        {services => {
          const service = (services || []).find(s => s.metadata?.name === ref.name);
          const ports = asArray<ServicePort>(asRecord(service?.spec).ports).filter(isPlainObject);
          const portOptions: Option[] = ports.map(p => ({
            value: String(p.port),
            description: [p.name, p.protocol].filter(Boolean).join(' / '),
          }));
          return (
            <FieldGrid minWidth={160}>
              <BackendKindSelect path={path} kinds={backendKinds} />
              <ComboInput
                path={`${path}.name`}
                label={isService ? 'Service' : `${kind} name`}
                required
                options={
                  isService
                    ? names(services)
                    : names(backendObjects).map(option => ({
                        ...option,
                        description: describeBackendObject(
                          (backendObjects || []).find(o => o.metadata?.name === option.value)
                        ),
                      }))
                }
                onSelect={(_value, option) => {
                  // Picking a Service with a single port fills the port in.
                  if (!option || !isService) return;
                  const picked = (services || []).find(s => s.metadata?.name === option.value);
                  const pickedPorts = asArray<ServicePort>(asRecord(picked?.spec).ports);
                  if (pickedPorts.length === 1 && pickedPorts[0]?.port !== undefined) {
                    set(`${path}.port`, pickedPorts[0].port);
                  }
                }}
              />
              {isService && portOptions.length > 0 ? (
                <Combo
                  label="Port"
                  required
                  value={ref.port === undefined ? '' : asString(ref.port)}
                  onChange={text =>
                    set(
                      `${path}.port`,
                      text === '' ? undefined : /^\d+$/.test(text) ? Number(text) : text
                    )
                  }
                  options={portOptions}
                  error={!!portIssue.error}
                  helper={
                    portIssue.error ||
                    (ref.port !== undefined && !ports.some(p => p.port === ref.port)
                      ? 'The Service does not expose this port'
                      : undefined)
                  }
                  onBlur={portIssue.onBlur}
                />
              ) : (
                <NumberInput
                  path={`${path}.port`}
                  label="Port"
                  required={isService}
                  min={1}
                  max={65535}
                />
              )}
              {withWeight && (
                <NumberInput
                  path={`${path}.weight`}
                  label="Weight"
                  min={0}
                  max={1000000}
                  placeholder="1"
                  help="Relative share of traffic"
                />
              )}
              <NamespaceInput
                path={`${path}.namespace`}
                label="Namespace"
                placeholder={namespace || 'Same as the route'}
              />
            </FieldGrid>
          );
        }}
      </WithNamespacedList>
      {note && (
        <Alert severity="info" sx={{ mt: 1.5 }}>
          {note}
        </Alert>
      )}
      {crossNamespace && crossNamespaceHint && (
        <Alert severity="info" sx={{ mt: 1.5 }}>
          This backend is in another namespace. A ReferenceGrant in "{asString(ref.namespace)}" must
          allow this route to reference it.
        </Alert>
      )}
    </Box>
  );
}

/** Group and kind of a backend, for non-Service backends. */
export function BackendKindFields({ path }: { path: string }) {
  return (
    <FieldGrid minWidth={160}>
      <TextInput
        path={`${path}.group`}
        label="Group"
        placeholder="(core)"
        help="API group of the backend; empty for Services"
      />
      <TextInput path={`${path}.kind`} label="Kind" placeholder="Service" />
    </FieldGrid>
  );
}

function parentOptions(
  gateways: KubeJson[],
  listenerSets: KubeJson[],
  namespace?: string
): Option[] {
  const option = (obj: KubeJson, kind: string): Option => {
    const listeners = asArray<Listener>(asRecord(obj.spec).listeners).filter(isPlainObject);
    return {
      value: `${kind === 'Gateway' ? '' : `${kind}:`}${obj.metadata?.namespace}/${
        obj.metadata?.name
      }`,
      label: `${kind === 'Gateway' ? '' : `${kind} `}${
        obj.metadata?.namespace === namespace ? '' : `${obj.metadata?.namespace}/`
      }${obj.metadata?.name}`,
      description: listeners.map(l => describeListener(l as unknown as Listener)).join(' · '),
    };
  };
  return [
    ...gateways.map(g => option(g, 'Gateway')),
    ...listenerSets.map(s => option(s, s.kind || 'ListenerSet')),
  ];
}

/**
 * Parent Gateway of a ListenerSet (`spec.parentRef`): the Gateways of the cluster with their
 * listeners and whether they accept ListenerSets from this namespace. Typing a name still works
 * when Gateways cannot be listed.
 */
export function ListenerSetParentFields({ path }: { path: string }) {
  const { get, update, value } = useForm();
  const data = useGatewayApiData();
  const namespace = value.metadata?.namespace;
  const ref = asRecord(get(path));
  const refName = asString(ref.name);
  const refNamespace = asString(ref.namespace) || namespace;
  const nameIssue = useFieldIssue(`${path}.name`);

  const gateways = (data.json('Gateway') || [])
    .slice()
    .sort((a, b) =>
      `${a.metadata?.namespace}/${a.metadata?.name}`.localeCompare(
        `${b.metadata?.namespace}/${b.metadata?.name}`
      )
    );
  const acceptance = {
    yes: 'Accepts ListenerSets from this namespace',
    no: 'Does not accept ListenerSets from this namespace',
    unknown: 'Acceptance of this namespace is unknown',
  };
  const options: Option[] = gateways.map(gateway => {
    const listeners = asArray<Listener>(asRecord(gateway.spec).listeners).filter(isPlainObject);
    const allowed = listenerSetAllowed(gateway, namespace, data.namespaceLabels);
    return {
      value: `${gateway.metadata?.namespace}/${gateway.metadata?.name}`,
      label: `${
        gateway.metadata?.namespace === namespace ? '' : `${gateway.metadata?.namespace}/`
      }${gateway.metadata?.name}`,
      description: [
        acceptance[allowed],
        ...listeners.map(l => describeListener(l as unknown as Listener)),
      ].join(' · '),
    };
  });

  const parent = gateways.find(
    gateway => gateway.metadata?.name === refName && gateway.metadata?.namespace === refNamespace
  );
  const currentValue = refName ? `${refNamespace}/${refName}` : '';
  const displayValue = options.some(o => o.value === currentValue) ? currentValue : refName;

  const selectGateway = (text: string, option?: Option) => {
    update(current => {
      const next: Record<string, unknown> = { ...asRecord(getIn(current, path)) };
      // Picked options and typed text may carry a namespace: `namespace/name`.
      const parsed = parseParentText(option ? option.value : text);
      next.name = parsed.name;
      if (parsed.namespace) {
        if (parsed.namespace !== namespace) next.namespace = parsed.namespace;
        else delete next.namespace;
      }
      return setIn(current, path, next);
    });
  };

  const allowed = parent ? listenerSetAllowed(parent, namespace, data.namespaceLabels) : undefined;

  return (
    <Box>
      <FieldGrid>
        <Combo
          label="Gateway"
          required
          value={displayValue}
          onChange={selectGateway}
          options={options}
          loading={data.list('Gateway') === null}
          error={!!nameIssue.error}
          helper={nameIssue.error || 'Gateway these listeners are added to'}
          onBlur={nameIssue.onBlur}
        />
        <NamespaceInput
          path={`${path}.namespace`}
          label="Gateway namespace"
          placeholder={namespace || 'Same namespace'}
        />
      </FieldGrid>
      {allowed === 'no' && (
        <Alert severity="warning" sx={{ mt: 1.5 }}>
          Gateway {refNamespace}/{refName} does not accept ListenerSets from namespace "
          {namespace || 'default'}". Set spec.allowedListeners on the Gateway (Same, All or a
          Selector that matches this namespace), otherwise the listeners are not attached.
        </Alert>
      )}
    </Box>
  );
}

/**
 * Fields of one parentRef of a route: the Gateway (or ListenerSet), optionally a specific
 * listener, and a live preview of whether the route would be accepted there.
 */
export function ParentRefFields({ path }: { path: string }) {
  const { get, update, value } = useForm();
  const data = useGatewayApiData();
  const routeNamespace = value.metadata?.namespace;
  const raw = asRecord(get(path));
  const ref = resolveParentRef(raw as { name: string }, routeNamespace);
  const nameIssue = useFieldIssue(`${path}.name`);

  const gateways = data.json('Gateway') || [];
  const listenerSets = data.json('ListenerSet') || [];
  const options = parentOptions(gateways, listenerSets, routeNamespace);

  const parent = [...gateways, ...listenerSets].find(
    candidate =>
      candidate.kind === ref.kind &&
      candidate.metadata?.name === ref.name &&
      candidate.metadata?.namespace === ref.namespace
  );
  const listeners = asArray<Listener>(asRecord(parent?.spec).listeners).filter(
    isPlainObject
  ) as unknown as Listener[];

  const currentValue = ref.name
    ? `${ref.kind === 'Gateway' ? '' : `${ref.kind}:`}${ref.namespace}/${ref.name}`
    : '';
  const displayValue = options.some(o => o.value === currentValue) ? currentValue : ref.name;

  const selectParent = (text: string, option?: Option) => {
    update(current => {
      const next: Record<string, unknown> = { ...asRecord(getIn(current, path)) };
      // Both picked options and typed text may carry a namespace: `[Kind:]namespace/name`.
      const parsed = parseParentText(option ? option.value : text);
      next.name = parsed.name;
      if (parsed.namespace) {
        if (parsed.namespace !== routeNamespace) next.namespace = parsed.namespace;
        else delete next.namespace;
      }
      if (option) {
        // A picked parent replaces the whole target, including kind and listener.
        if (parsed.kind) {
          next.kind = parsed.kind;
          next.group =
            listenerSets.find(set => set.kind === parsed.kind)?.apiVersion?.split('/')[0] ||
            GATEWAY_GROUP;
        } else {
          delete next.kind;
          delete next.group;
        }
        delete next.sectionName;
        delete next.port;
      }
      return setIn(current, path, next);
    });
  };

  const verdict =
    parent && ref.name ? evaluateAttachment(value, ref, parent, data.namespaceLabels) : undefined;

  return (
    <Box>
      <FieldGrid minWidth={200}>
        <Combo
          label="Gateway"
          required
          value={displayValue}
          onChange={selectParent}
          options={options}
          loading={data.list('Gateway') === null}
          error={!!nameIssue.error}
          helper={nameIssue.error || 'Gateway (or ListenerSet) this route attaches to'}
          onBlur={nameIssue.onBlur}
        />
        <NamespaceInput
          path={`${path}.namespace`}
          label="Gateway namespace"
          placeholder={routeNamespace || 'Same as the route'}
        />
        {listeners.length > 0 ? (
          <SelectInput
            path={`${path}.sectionName`}
            label="Listener"
            emptyLabel="All listeners"
            options={listeners.map(listener => ({
              value: listener.name,
              description: describeListener(listener),
            }))}
            help="Restrict the route to one listener of the Gateway"
          />
        ) : (
          <TextInput
            path={`${path}.sectionName`}
            label="Listener (section name)"
            placeholder="All listeners"
          />
        )}
        <NumberInput
          path={`${path}.port`}
          label="Port"
          min={1}
          max={65535}
          placeholder="Any"
          help="Restrict the route to listeners on this port"
        />
      </FieldGrid>
      {ref.name && !parent && data.list('Gateway') !== null && ref.kind === 'Gateway' && (
        <Alert severity="warning" sx={{ mt: 1.5 }}>
          Gateway {ref.namespace}/{ref.name} was not found. The route stays detached until it
          exists.
        </Alert>
      )}
      {verdict && verdict.attaches === 'yes' && (
        <Alert severity="success" sx={{ mt: 1.5 }}>
          Accepted by listener
          {verdict.listeners.filter(l => l.attaches === 'yes').length === 1 ? ' ' : 's '}
          {verdict.listeners
            .filter(l => l.attaches === 'yes')
            .map(l => l.listener.name)
            .join(', ')}
          .
        </Alert>
      )}
      {verdict && verdict.attaches === 'unknown' && (
        <Alert severity="info" sx={{ mt: 1.5 }}>
          Whether the listeners accept this route depends on a namespace selector that could not be
          evaluated.
        </Alert>
      )}
      {verdict && verdict.attaches === 'no' && (
        <Alert severity="warning" sx={{ mt: 1.5 }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {verdict.summary}
          </Typography>
          <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
            {verdict.listeners.map(listenerVerdict => (
              <li key={listenerVerdict.listener.name}>
                {listenerVerdict.listener.name}: {listenerVerdict.reasons.join('; ')}
              </li>
            ))}
          </Box>
        </Alert>
      )}
    </Box>
  );
}
