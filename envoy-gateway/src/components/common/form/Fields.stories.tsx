import { Box } from '@mui/material';
import { Meta, StoryFn } from '@storybook/react';
import React from 'react';
import {
  DurationInput,
  FieldGrid,
  FormSection,
  NumberInput,
  SelectInput,
  StringListInput,
  SwitchInput,
  ToggleSection,
  useBinder,
} from '../../../common/form/Fields';
import { SummaryList, Wizard } from '../../../common/form/Wizard';
import { KubeJson } from '../../../resources/types';

export default {
  title: 'EnvoyGateway/FormFields',
  decorators: [
    Story => (
      <Box sx={{ p: 3, maxWidth: 900 }}>
        <Story />
      </Box>
    ),
  ],
} as Meta;

function Playground({ initial }: { initial: KubeJson }) {
  const [value, setValue] = React.useState<KubeJson>(initial);
  const bind = useBinder<KubeJson>(value, setValue);
  return (
    <>
      <FormSection
        title="Timeouts"
        description="Durations are validated as you type."
        icon="mdi:timer-outline"
      >
        <FieldGrid>
          <DurationInput
            label="Request timeout"
            {...bind(['spec', 'timeout', 'http', 'requestTimeout'])}
          />
          <NumberInput
            label="Number of retries"
            min={0}
            max={10}
            {...bind(['spec', 'retry', 'numRetries'])}
          />
          <SelectInput
            label="Algorithm"
            options={['RoundRobin', 'LeastRequest', 'Random']}
            {...bind(['spec', 'loadBalancer', 'type'])}
          />
          <StringListInput
            label="Retry on"
            suggestions={['5xx', 'reset', 'connect-failure']}
            {...bind(['spec', 'retry', 'retryOn', 'triggers'])}
          />
        </FieldGrid>
      </FormSection>
      <ToggleSection
        title="Compression"
        icon="mdi:zip-box-outline"
        enabled={!!value.spec?.compression}
        onToggle={on => bind(['spec', 'compression']).onChange(on ? [{ type: 'Gzip' }] : undefined)}
      >
        <SwitchInput label="Use client protocol" {...bind(['spec', 'useClientProtocol'])} />
      </ToggleSection>
      <Box component="pre" sx={{ fontSize: 12 }}>
        {JSON.stringify(value, null, 2)}
      </Box>
    </>
  );
}

export const Fields: StoryFn = () => (
  <Playground
    initial={{
      apiVersion: 'gateway.envoyproxy.io/v1alpha1',
      kind: 'BackendTrafficPolicy',
      metadata: { name: 'example' },
      spec: {},
    }}
  />
);

/** Error state: invalid values are highlighted inline. */
export const FieldsWithErrors: StoryFn = () => (
  <Playground
    initial={{
      apiVersion: 'gateway.envoyproxy.io/v1alpha1',
      kind: 'BackendTrafficPolicy',
      metadata: { name: 'example' },
      spec: { timeout: { http: { requestTimeout: '10 seconds' } }, retry: { numRetries: 42 } },
    }}
  />
);

export const WizardSteps: StoryFn = () => (
  <Wizard
    submitLabel="Create"
    submitting={false}
    onSubmit={() => undefined}
    allErrors={[]}
    steps={[
      { id: 'a', label: 'Target', content: 'Pick the Gateway.' },
      { id: 'b', label: 'Scenarios', content: 'Choose presets.', optional: true },
      {
        id: 'c',
        label: 'Review',
        content: <SummaryList rows={[{ label: 'Name', value: 'backend-resilience' }]} />,
      },
    ]}
  />
);

/** Error state: a step with blocking errors cannot be left with "Next". */
export const WizardBlocked: StoryFn = () => (
  <Wizard
    submitLabel="Create"
    submitting={false}
    onSubmit={() => undefined}
    allErrors={[{ key: 'Name is required' }]}
    steps={[
      {
        id: 'a',
        label: 'Target',
        content: 'Name is missing.',
        errors: [{ key: 'Name is required' }],
      },
      { id: 'b', label: 'Review', content: 'Summary' },
    ]}
  />
);
