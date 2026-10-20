/**
 * Interpretation of Gateway API status conditions.
 *
 * The rules follow the Gateway API conventions (and are exercised against the reasons Envoy
 * Gateway reports), but do not depend on any implementation: every controller that sets the
 * standard condition types is understood.
 *
 * @see https://gateway-api.sigs.k8s.io/geps/gep-1364/
 */
import {
  Condition,
  ListenerStatus,
  ParentReference,
  PolicyAncestorStatus,
  RouteParentStatus,
} from '../resources/types';
import { asArray, asRecord, isPlainObject } from './objects';

export type HealthLevel = 'healthy' | 'warning' | 'error' | 'pending' | 'none';

export interface Problem {
  level: 'warning' | 'error' | 'pending';
  /** What the condition is about, e.g. `Listener https` or `Parent infra/eg`; empty for the object itself. */
  scope: string;
  /** Condition type, e.g. `Programmed`. */
  type: string;
  reason?: string;
  message?: string;
}

export interface Health {
  level: HealthLevel;
  /** Short label for chips and table cells, e.g. `Programmed` or `Not accepted`. */
  label: string;
  problems: Problem[];
}

/** Conditions that describe a problem when they are `True`. */
const NEGATIVE_POLARITY: Record<string, 'warning' | 'error'> = {
  Conflicted: 'error',
  OverlappingTLSConfig: 'warning',
  PartiallyInvalid: 'warning',
  InsecureFrontendValidationMode: 'warning',
};

/** Reasons that mean "the controller has not finished yet" rather than "this failed". */
const PENDING_REASONS = new Set(['Pending', 'Waiting', 'WaitingForController']);

/**
 * Reasons that accompany a `True` condition but still deserve attention. Envoy Gateway, like the
 * spec allows, reports `Accepted=True` with `ListenersNotValid` when only some listeners are valid.
 */
const DEGRADED_TRUE_REASONS = new Set(['ListenersNotValid']);

/** Plain-language explanations of the common condition reasons. */
const REASON_HINTS: Record<string, string> = {
  Pending: 'No controller has processed this object yet.',
  NoResources: 'The controller could not create the data plane resources (proxy pods, service).',
  AddressNotAssigned:
    'No address has been assigned. On clusters without a load balancer implementation the Service of type LoadBalancer stays pending.',
  AddressNotUsable: 'A requested address cannot be used by this Gateway.',
  ListenersNotValid: 'At least one listener is invalid; see the listener conditions.',
  InvalidParameters: 'The object referenced by parametersRef is missing or invalid.',
  UnsupportedVersion: 'The installed Gateway API CRDs are not supported by this controller.',
  NotAllowedByListeners:
    'No listener of the parent allows this route: check allowedRoutes (namespaces and kinds).',
  NoMatchingListenerHostname: 'No listener hostname overlaps with the hostnames of this route.',
  NoMatchingParent:
    'The parent has no listener matching the sectionName or port of this reference.',
  NotAllowedByParent: 'The parent Gateway does not allow listeners from this namespace.',
  ParentNotAccepted: 'The parent Gateway has not been accepted by its controller.',
  UnsupportedValue: 'A field uses a value the controller does not support.',
  RefNotPermitted:
    'A cross-namespace reference is not permitted: a ReferenceGrant in the target namespace is required.',
  BackendNotFound: 'A referenced backend does not exist.',
  InvalidKind: 'A reference uses a kind the controller does not support.',
  UnsupportedProtocol: 'The backend uses a protocol the controller does not support.',
  InvalidCertificateRef: 'A TLS certificate reference is missing, malformed or not permitted.',
  InvalidRouteKinds: 'allowedRoutes lists a route kind this listener cannot serve.',
  HostnameConflict: 'Another listener on the same port already uses this hostname.',
  ProtocolConflict: 'Another listener on the same port uses an incompatible protocol.',
  PortUnavailable: 'The requested port is not available on the Gateway.',
  ListenerConflict: 'This listener conflicts with a listener defined elsewhere.',
  IncompatibleFilters: 'The rule combines filters that cannot be used together.',
  Invalid: 'The object is invalid; see the message for details.',
  NoValidCACertificate: 'None of the referenced CA certificates could be used.',
  InvalidCACertificateRef: 'A CA certificate reference is missing or malformed.',
  TargetNotFound: 'The policy target does not exist.',
  Conflicted: 'Another policy already targets the same resource.',
};

/** Explains a condition reason in plain language, when the reason is a well-known one. */
export function reasonHint(reason?: string): string | undefined {
  return reason ? REASON_HINTS[reason] : undefined;
}

export function findCondition(
  conditions: Condition[] | undefined,
  type: string
): Condition | undefined {
  return asArray<Condition>(conditions).find(c => c?.type === type);
}

export function isConditionTrue(conditions: Condition[] | undefined, type: string): boolean {
  return findCondition(conditions, type)?.status === 'True';
}

interface EvaluateOptions {
  /** Condition types that must be present and `True`. */
  expected: string[];
  /** `metadata.generation`; conditions that observed an older generation are stale. */
  generation?: number;
  scope?: string;
}

/** Turns a list of conditions into the problems they describe. */
export function evaluateConditions(
  conditions: Condition[] | undefined,
  options: EvaluateOptions
): Problem[] {
  const { expected, generation, scope = '' } = options;
  const list = asArray<Condition>(conditions).filter(c => isPlainObject(c) && !!c.type);
  const problems: Problem[] = [];

  for (const type of expected) {
    if (!list.some(c => c.type === type)) {
      problems.push({
        level: 'pending',
        scope,
        type,
        reason: 'Pending',
        message: `The ${type} condition has not been reported yet.`,
      });
    }
  }

  for (const condition of list) {
    const base = {
      scope,
      type: condition.type,
      reason: condition.reason,
      message: condition.message,
    };
    const negative = NEGATIVE_POLARITY[condition.type];

    if (negative) {
      if (condition.status === 'True') problems.push({ level: negative, ...base });
      continue;
    }

    if (condition.status === 'True') {
      if (condition.reason && DEGRADED_TRUE_REASONS.has(condition.reason)) {
        problems.push({ level: 'warning', ...base });
      } else if (
        generation !== undefined &&
        condition.observedGeneration !== undefined &&
        condition.observedGeneration < generation
      ) {
        problems.push({
          level: 'pending',
          ...base,
          reason: 'Stale',
          message: 'The controller has not processed the latest change to this object yet.',
        });
      }
      continue;
    }

    const pending =
      condition.status === 'Unknown' ||
      (!!condition.reason && PENDING_REASONS.has(condition.reason));
    problems.push({ level: pending ? 'pending' : 'error', ...base });
  }

  return problems;
}

function worstLevel(problems: Problem[]): HealthLevel {
  if (problems.some(p => p.level === 'error')) return 'error';
  if (problems.some(p => p.level === 'warning')) return 'warning';
  if (problems.some(p => p.level === 'pending')) return 'pending';
  return 'healthy';
}

const NEGATED_LABELS: Record<string, string> = {
  Accepted: 'Not accepted',
  Programmed: 'Not programmed',
  ResolvedRefs: 'Unresolved refs',
  Ready: 'Not ready',
  SupportedVersion: 'Unsupported version',
  Conflicted: 'Conflicted',
  PartiallyInvalid: 'Partially invalid',
  OverlappingTLSConfig: 'Overlapping TLS',
};

/** Short title of a problem, e.g. `Listener https: Unresolved refs`. */
export function problemTitle(problem: Problem): string {
  let base: string;
  if (NEGATIVE_POLARITY[problem.type]) {
    base = NEGATED_LABELS[problem.type] || problem.type;
  } else if (problem.level === 'warning') {
    base = `${problem.type}, degraded`;
  } else if (problem.level === 'pending') {
    base = `${problem.type} pending`;
  } else {
    base = NEGATED_LABELS[problem.type] || `Not ${problem.type}`;
  }
  return problem.scope ? `${problem.scope}: ${base}` : base;
}

function healthFrom(problems: Problem[], healthyLabel: string): Health {
  const level = worstLevel(problems);
  if (level === 'healthy') return { level, label: healthyLabel, problems };
  if (level === 'pending') return { level, label: 'Pending', problems };
  const first = problems.find(p => p.level === level)!;
  const label =
    level === 'warning' && !NEGATIVE_POLARITY[first.type]
      ? 'Degraded'
      : NEGATED_LABELS[first.type] || `Not ${first.type}`;
  return { level, label, problems };
}

export function formatParentRef(ref: ParentReference | undefined, defaultNamespace?: string) {
  if (!ref) return '';
  const namespace = ref.namespace || defaultNamespace;
  const kind = ref.kind && ref.kind !== 'Gateway' ? `${ref.kind} ` : '';
  const section = ref.sectionName ? `/${ref.sectionName}` : '';
  const port = ref.port ? `:${ref.port}` : '';
  return `${kind}${namespace ? `${namespace}/` : ''}${ref.name}${section}${port}`;
}

interface StatusObject {
  kind?: string;
  metadata?: { generation?: number; namespace?: string };
  spec?: unknown;
  status?: unknown;
}

/** Expected top-level conditions per kind that reports its own conditions. */
const EXPECTED_CONDITIONS: Record<string, string[]> = {
  GatewayClass: ['Accepted'],
  Gateway: ['Accepted', 'Programmed'],
  ListenerSet: ['Accepted', 'Programmed'],
};

const HEALTHY_LABELS: Record<string, string> = {
  Gateway: 'Programmed',
  ListenerSet: 'Programmed',
};

const PARENT_KINDS = new Set(['HTTPRoute', 'GRPCRoute', 'TLSRoute', 'TCPRoute', 'UDPRoute']);
const ANCESTOR_KINDS = new Set(['BackendTLSPolicy']);

function listenerProblems(listeners: ListenerStatus[] | undefined, generation?: number) {
  return asArray<ListenerStatus>(listeners).flatMap(listener =>
    evaluateConditions(listener?.conditions, {
      expected: [],
      generation,
      scope: `Listener ${listener?.name ?? ''}`.trim(),
    })
  );
}

/**
 * Computes the health of any Gateway API object from its status.
 *
 * - GatewayClass, Gateway and ListenerSet report conditions on the object (and per listener).
 * - Routes report conditions per parent; policies per ancestor.
 * - ReferenceGrant has no status at all.
 */
export function computeHealth(obj: StatusObject | null | undefined): Health {
  if (!obj) return { level: 'none', label: '', problems: [] };
  const kind = obj.kind || '';
  const generation = obj.metadata?.generation;
  const status = asRecord<{
    conditions?: Condition[];
    listeners?: ListenerStatus[];
    parents?: RouteParentStatus[];
    ancestors?: PolicyAncestorStatus[];
  }>(obj.status);

  if (EXPECTED_CONDITIONS[kind]) {
    const problems = [
      ...evaluateConditions(status.conditions, {
        expected: EXPECTED_CONDITIONS[kind],
        generation,
      }),
      ...listenerProblems(status.listeners, generation),
    ];
    return healthFrom(problems, HEALTHY_LABELS[kind] || 'Accepted');
  }

  if (PARENT_KINDS.has(kind)) {
    const parents = asArray<RouteParentStatus>(status.parents);
    if (parents.length === 0) {
      const hasParentRefs = asArray(asRecord(obj.spec).parentRefs).length > 0;
      return {
        level: 'pending',
        label: hasParentRefs ? 'Pending' : 'No parents',
        problems: [
          {
            level: 'pending',
            scope: '',
            type: 'Accepted',
            reason: hasParentRefs ? 'Pending' : 'NoParents',
            message: hasParentRefs
              ? 'No controller has reported a status for this route yet.'
              : 'The route has no parentRefs, so it is not attached to any Gateway.',
          },
        ],
      };
    }
    const problems = parents.flatMap(parent =>
      evaluateConditions(parent?.conditions, {
        expected: ['Accepted', 'ResolvedRefs'],
        generation,
        scope: `Parent ${formatParentRef(parent?.parentRef, obj.metadata?.namespace)}`,
      })
    );
    return healthFrom(problems, 'Accepted');
  }

  if (ANCESTOR_KINDS.has(kind)) {
    const ancestors = asArray<PolicyAncestorStatus>(status.ancestors);
    if (ancestors.length === 0) {
      return {
        level: 'pending',
        label: 'Pending',
        problems: [
          {
            level: 'pending',
            scope: '',
            type: 'Accepted',
            reason: 'Pending',
            message:
              'No controller has reported a status. The policy takes effect once a route attached to a Gateway uses the targeted backend.',
          },
        ],
      };
    }
    const problems = ancestors.flatMap(ancestor =>
      evaluateConditions(ancestor?.conditions, {
        expected: ['Accepted'],
        generation,
        scope: `Ancestor ${formatParentRef(ancestor?.ancestorRef, obj.metadata?.namespace)}`,
      })
    );
    return healthFrom(problems, 'Accepted');
  }

  return { level: 'none', label: '', problems: [] };
}

/** Health of a single listener, from its status entry. */
export function listenerHealth(status: ListenerStatus | undefined, generation?: number): Health {
  if (!status) {
    return {
      level: 'pending',
      label: 'Pending',
      problems: [
        {
          level: 'pending',
          scope: '',
          type: 'Programmed',
          reason: 'Pending',
          message: 'The controller has not reported a status for this listener yet.',
        },
      ],
    };
  }
  return healthFrom(
    evaluateConditions(status.conditions, { expected: ['Accepted', 'Programmed'], generation }),
    'Programmed'
  );
}

/** Health of a list of conditions that are all expected to be `True` (parent / ancestor status). */
export function conditionsHealth(
  conditions: Condition[] | undefined,
  expected: string[],
  generation?: number
): Health {
  return healthFrom(evaluateConditions(conditions, { expected, generation }), expected[0] || 'OK');
}

export interface HealthCounts {
  total: number;
  healthy: number;
  warning: number;
  error: number;
  pending: number;
  none: number;
}

export function emptyCounts(): HealthCounts {
  return { total: 0, healthy: 0, warning: 0, error: 0, pending: 0, none: 0 };
}

export function countHealth(objects: Array<StatusObject | null | undefined>): HealthCounts {
  const counts = emptyCounts();
  for (const obj of objects) {
    counts.total += 1;
    counts[computeHealth(obj).level] += 1;
  }
  return counts;
}

export interface ConditionTally {
  type: string;
  true: number;
  false: number;
  unknown: number;
}

/**
 * Tallies one condition type across objects. Routes and policies count once per parent/ancestor,
 * because the same route can be accepted by one Gateway and rejected by another.
 */
export function tallyCondition(
  objects: Array<StatusObject | null | undefined>,
  type: string
): ConditionTally {
  const tally: ConditionTally = { type, true: 0, false: 0, unknown: 0 };
  const add = (conditions: Condition[] | undefined) => {
    const condition = findCondition(conditions, type);
    if (!condition) return;
    if (condition.status === 'True') tally.true += 1;
    else if (condition.status === 'False') tally.false += 1;
    else tally.unknown += 1;
  };

  for (const obj of objects) {
    if (!obj) continue;
    const status = asRecord<{
      conditions?: Condition[];
      parents?: RouteParentStatus[];
      ancestors?: PolicyAncestorStatus[];
    }>(obj.status);
    if (Array.isArray(status.conditions)) add(status.conditions);
    for (const parent of asArray<RouteParentStatus>(status.parents)) add(parent?.conditions);
    for (const ancestor of asArray<PolicyAncestorStatus>(status.ancestors)) {
      add(ancestor?.conditions);
    }
  }
  return tally;
}
