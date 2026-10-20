/** List and detail pages of ReferenceGrant and BackendTLSPolicy. */
import {
  NameValueTable,
  SectionBox,
  SimpleTable,
} from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Stack, Typography } from '@mui/material';
import React from 'react';
import { GatewayApiDataValue } from '../../data/GatewayApiData';
import { BackendTLSPolicy, ReferenceGrant } from '../../resources/classes';
import { ROUTE_KINDS } from '../../resources/registry';
import {
  BackendTLSPolicyValidation,
  KubeJson,
  LocalObjectReference,
  LocalPolicyTargetReference,
  ReferenceGrantFrom,
  ReferenceGrantTo,
  SubjectAltName,
} from '../../resources/types';
import { asArray, isPlainObject } from '../../utils/objects';
import { grantUsage, OutgoingRef } from '../../utils/referenceGrants';
import { RefLink } from '../common/RefLink';
import { KeyValueChips, Mono } from '../common/Renderers';
import { Dash } from '../common/Status';
import { KindDetailView, KindListView } from '../common/Views';

function groupLabel(group?: string): string {
  return group ? group : 'core';
}

// ---------------------------------------------------------------------------------------------
// ReferenceGrant
// ---------------------------------------------------------------------------------------------

function fromText(from?: ReferenceGrantFrom[]): string {
  return asArray<ReferenceGrantFrom>(from)
    .filter(isPlainObject)
    .map(f => `${f.kind} in ${f.namespace}`)
    .join(', ');
}

function toText(to?: ReferenceGrantTo[]): string {
  return asArray<ReferenceGrantTo>(to)
    .filter(isPlainObject)
    .map(t => `${t.kind}${t.name ? `/${t.name}` : ' (any)'}`)
    .join(', ');
}

export function ReferenceGrantList() {
  return (
    <KindListView<ReferenceGrant>
      kind="ReferenceGrant"
      columns={() => [
        {
          id: 'from',
          label: 'Allows (from)',
          gridTemplate: 2,
          getValue: item => fromText(item.spec?.from),
        },
        {
          id: 'to',
          label: 'To reference',
          gridTemplate: 2,
          getValue: item => toText(item.spec?.to),
        },
      ]}
    />
  );
}

function GrantUsageSection({ grant, data }: { grant: KubeJson; data: GatewayApiDataValue }) {
  const sources = [
    ...data.routes,
    ...(data.json('Gateway') || []),
    ...(data.json('ListenerSet') || []),
  ];
  const usage = grantUsage(grant, sources);

  return (
    <SectionBox title={`References using this grant (${usage.length})`}>
      <SimpleTable
        data={data.loading ? null : usage}
        emptyMessage="No reference currently relies on this grant."
        columns={[
          {
            label: 'From',
            gridTemplate: 2,
            getter: (ref: OutgoingRef) => <RefLink target={ref.from} showKind />,
          },
          { label: 'Purpose', getter: (ref: OutgoingRef) => ref.purpose },
          {
            label: 'To',
            gridTemplate: 2,
            getter: (ref: OutgoingRef) => <RefLink target={ref.to} showKind />,
          },
        ]}
      />
    </SectionBox>
  );
}

export function ReferenceGrantDetail() {
  return (
    <KindDetailView<ReferenceGrant>
      kind="ReferenceGrant"
      related={['Gateway', 'ListenerSet', ...ROUTE_KINDS]}
      sections={(item, data) => [
        {
          id: 'gwapi-grant-from',
          section: (
            <SectionBox title="From: who may reference">
              <SimpleTable
                data={asArray<ReferenceGrantFrom>(item.spec?.from)}
                emptyMessage="No sources are defined."
                columns={[
                  { label: 'Group', getter: (from: ReferenceGrantFrom) => groupLabel(from.group) },
                  { label: 'Kind', getter: (from: ReferenceGrantFrom) => from.kind },
                  {
                    label: 'Namespace',
                    getter: (from: ReferenceGrantFrom) => (
                      <RefLink target={{ group: '', kind: 'Namespace', name: from.namespace }} />
                    ),
                  },
                ]}
              />
            </SectionBox>
          ),
        },
        {
          id: 'gwapi-grant-to',
          section: (
            <SectionBox title={`To: what may be referenced in "${item.metadata.namespace}"`}>
              <SimpleTable
                data={asArray<ReferenceGrantTo>(item.spec?.to)}
                emptyMessage="No targets are defined."
                columns={[
                  { label: 'Group', getter: (to: ReferenceGrantTo) => groupLabel(to.group) },
                  { label: 'Kind', getter: (to: ReferenceGrantTo) => to.kind },
                  {
                    label: 'Name',
                    getter: (to: ReferenceGrantTo) =>
                      to.name ? (
                        <RefLink
                          target={{
                            group: to.group ?? '',
                            kind: to.kind,
                            namespace: item.metadata.namespace,
                            name: to.name,
                          }}
                          fromNamespace={item.metadata.namespace}
                        />
                      ) : (
                        <Typography component="span" variant="body2" color="text.secondary">
                          Any {to.kind} in this namespace
                        </Typography>
                      ),
                  },
                ]}
              />
            </SectionBox>
          ),
        },
        {
          id: 'gwapi-grant-usage',
          section: <GrantUsageSection grant={item.json} data={data} />,
        },
      ]}
    />
  );
}

// ---------------------------------------------------------------------------------------------
// Shared: policy targets and backend TLS validation
// ---------------------------------------------------------------------------------------------

function targetsText(targetRefs?: LocalPolicyTargetReference[]): string {
  return asArray<LocalPolicyTargetReference>(targetRefs)
    .filter(isPlainObject)
    .map(t => `${t.kind}/${t.name}${t.sectionName ? ` (${t.sectionName})` : ''}`)
    .join(', ');
}

function TargetLinks({
  targetRefs,
  namespace,
}: {
  targetRefs?: LocalPolicyTargetReference[];
  namespace?: string;
}) {
  const targets = asArray<LocalPolicyTargetReference>(targetRefs).filter(
    isPlainObject
  ) as unknown as LocalPolicyTargetReference[];
  if (targets.length === 0) return <Dash />;
  return (
    <Stack spacing={0.25}>
      {targets.map((target, index) => (
        <RefLink
          key={index}
          target={{ group: target.group ?? '', kind: target.kind, namespace, name: target.name }}
          fromNamespace={namespace}
          showKind
          suffix={target.sectionName ? ` (port ${target.sectionName})` : ''}
        />
      ))}
    </Stack>
  );
}

function caText(validation?: BackendTLSPolicyValidation): string {
  if (!validation) return '';
  if (validation.wellKnownCACertificates) {
    return `Well-known (${validation.wellKnownCACertificates})`;
  }
  return asArray<LocalObjectReference>(validation.caCertificateRefs)
    .map(ref => `${ref?.kind}/${ref?.name}`)
    .join(', ');
}

function ValidationRows({
  validation,
  namespace,
}: {
  validation?: BackendTLSPolicyValidation;
  namespace?: string;
}) {
  const caRefs = asArray<LocalObjectReference>(validation?.caCertificateRefs).filter(
    isPlainObject
  ) as unknown as LocalObjectReference[];
  const sans = asArray<SubjectAltName>(validation?.subjectAltNames);
  return (
    <NameValueTable
      rows={[
        {
          name: 'Hostname (SNI and certificate)',
          value: validation?.hostname ? <Mono>{validation.hostname}</Mono> : <Dash />,
        },
        {
          name: 'CA certificates',
          value: validation?.wellKnownCACertificates ? (
            `Well-known CA certificates (${validation.wellKnownCACertificates})`
          ) : caRefs.length > 0 ? (
            <Stack spacing={0.25}>
              {caRefs.map((ref, index) => (
                <RefLink
                  key={index}
                  target={{ group: ref.group ?? '', kind: ref.kind, namespace, name: ref.name }}
                  fromNamespace={namespace}
                  showKind
                />
              ))}
            </Stack>
          ) : (
            <Dash />
          ),
        },
        {
          name: 'Subject alternative names',
          value: sans.map(san => `${san?.type}: ${san?.hostname || san?.uri || ''}`).join(', '),
          hide: sans.length === 0,
        },
      ]}
    />
  );
}

// ---------------------------------------------------------------------------------------------
// BackendTLSPolicy
// ---------------------------------------------------------------------------------------------

export function BackendTLSPolicyList() {
  return (
    <KindListView<BackendTLSPolicy>
      kind="BackendTLSPolicy"
      columns={() => [
        {
          id: 'targets',
          label: 'Targets',
          gridTemplate: 1.5,
          getValue: item => targetsText(item.spec?.targetRefs),
          render: item => (
            <TargetLinks targetRefs={item.spec?.targetRefs} namespace={item.metadata.namespace} />
          ),
        },
        {
          id: 'hostname',
          label: 'Hostname',
          getValue: item => item.spec?.validation?.hostname,
        },
        {
          id: 'ca',
          label: 'CA certificates',
          getValue: item => caText(item.spec?.validation),
        },
      ]}
    />
  );
}

export function BackendTLSPolicyDetail() {
  return (
    <KindDetailView<BackendTLSPolicy>
      kind="BackendTLSPolicy"
      extraInfo={item => [
        {
          name: 'Targets',
          value: (
            <TargetLinks targetRefs={item.spec?.targetRefs} namespace={item.metadata.namespace} />
          ),
        },
      ]}
      sections={item => [
        {
          id: 'gwapi-btls-validation',
          section: (
            <SectionBox title="TLS validation">
              <ValidationRows
                validation={item.spec?.validation}
                namespace={item.metadata.namespace}
              />
            </SectionBox>
          ),
        },
        {
          id: 'gwapi-btls-options',
          section: item.spec?.options && Object.keys(item.spec.options).length > 0 && (
            <SectionBox title="Options">
              <KeyValueChips values={item.spec.options} />
            </SectionBox>
          ),
        },
      ]}
    />
  );
}
