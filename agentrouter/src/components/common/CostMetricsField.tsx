import { MenuItem } from '@mui/material';
import React from 'react';
import { LLM_REQUEST_COST_TYPES, LLMRequestCostType } from '../../resources/common';
import { CostForm, newCost } from '../../utils/costForm';
import { FieldGrid, FullRow, RepeatedField, TextInput } from './FormFields';

/** Editor for a list of LLM request cost metrics (metadata key + type + optional CEL). */
export function CostMetricsField({
  costs,
  onChange,
}: {
  costs: CostForm[];
  onChange: (costs: CostForm[]) => void;
}) {
  return (
    <RepeatedField
      items={costs}
      onChange={onChange}
      addLabel="Add Cost Metric"
      itemTitle={i => `Cost Metric ${i + 1}`}
      createItem={newCost}
      render={(c, update) => (
        <FieldGrid>
          <TextInput
            label="Metadata key"
            required
            value={c.metadataKey}
            onChange={e => update({ metadataKey: e.target.value.trim() })}
          />
          <TextInput
            select
            label="Type"
            value={c.type}
            onChange={e => update({ type: e.target.value as LLMRequestCostType })}
          >
            {LLM_REQUEST_COST_TYPES.map(t => (
              <MenuItem key={t} value={t}>
                {t}
              </MenuItem>
            ))}
          </TextInput>
          {c.type === 'CEL' && (
            <FullRow>
              <TextInput
                label="CEL expression"
                required
                value={c.cel}
                onChange={e => update({ cel: e.target.value })}
                placeholder="input_tokens + output_tokens * 2"
                helperText="Variables: model, backend, input_tokens, cached_input_tokens, cache_creation_input_tokens, output_tokens, total_tokens, reasoning_tokens."
                InputProps={{ sx: { fontFamily: 'monospace' } }}
              />
            </FullRow>
          )}
        </FieldGrid>
      )}
    />
  );
}
