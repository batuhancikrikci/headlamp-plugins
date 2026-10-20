import { Box } from '@mui/material';
import { Meta, StoryFn } from '@storybook/react';
import React from 'react';
import { CRDDocsView, SchemaState } from './CRDDocsViewer';

/** A small, made-up CRD schema that exercises every part of the viewer. */
const root = {
  type: 'object',
  required: ['spec'],
  properties: {
    apiVersion: { type: 'string', description: 'APIVersion of the object.' },
    kind: { type: 'string', description: 'Kind of the object.' },
    metadata: { type: 'object' },
    spec: {
      type: 'object',
      description: 'Desired state of the widget.',
      required: ['size'],
      properties: {
        size: {
          type: 'string',
          description: 'How large the widget is.',
          enum: ['Small', 'Medium', 'Large'],
          default: 'Medium',
        },
        replicas: { type: 'integer', description: 'Number of copies.', minimum: 1, maximum: 10 },
        ports: {
          type: 'array',
          description: 'Ports the widget listens on.',
          maxItems: 8,
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', pattern: '^[a-z0-9-]+$' },
              port: { 'x-kubernetes-int-or-string': true },
            },
          },
          'x-kubernetes-validations': [
            { rule: 'self.all(p, p.name != "")', message: 'Every port needs a name.' },
          ],
        },
        labels: { type: 'object', additionalProperties: { type: 'string' } },
      },
    },
  },
};

const ready: SchemaState = { phase: 'ready', crdName: 'widgets.example.com', version: 'v1', root };
const value = { spec: { size: 'Large', ports: [{ name: 'http', port: 80 }] } };

export default {
  title: 'Common/CRDDocsViewer',
  component: CRDDocsView,
  decorators: [
    Story => (
      <Box sx={{ height: 720, border: 1, borderColor: 'divider' }}>
        <Story />
      </Box>
    ),
  ],
} as Meta;

const Template: StoryFn<{ state: SchemaState }> = ({ state }) => (
  <CRDDocsView apiVersion="example.com/v1" kind="Widget" value={value} state={state} />
);

export const Schema = Template.bind({});
Schema.args = { state: ready };

export const Loading = Template.bind({});
Loading.args = { state: { phase: 'loading' } };

export const Forbidden = Template.bind({});
Forbidden.args = {
  state: { phase: 'failed', message: 'forbidden', builtIn: false, forbidden: true },
};

export const BuiltInKind = Template.bind({});
BuiltInKind.args = {
  state: {
    phase: 'failed',
    message:
      'Service is a built-in Kubernetes type; field documentation is only available for CRDs.',
    builtIn: true,
    forbidden: false,
  },
};
