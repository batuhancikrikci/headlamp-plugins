import { TextField } from '@mui/material';
import * as yaml from 'js-yaml';
import React from 'react';
import { useText } from '../i18n';
import { dumpAllYaml, dumpYaml, parseManifests } from '../yaml';

/**
 * Inline YAML editor for a free-form part of an object. The parsed value is only propagated
 * while the text is valid YAML of the expected shape; external changes re-sync the text.
 *
 * `manifests` mode edits a list of Kubernetes objects as a multi-document stream ("---").
 */
export function YamlField({
  label,
  value,
  onChange,
  expect = 'any',
  minRows = 10,
  helperText,
}: {
  label: string;
  value: unknown;
  onChange: (value: unknown) => void;
  expect?: 'array' | 'object' | 'manifests' | 'any';
  minRows?: number;
  helperText?: React.ReactNode;
}) {
  const { t } = useText();
  const serialize = (v: unknown) => {
    if (v === undefined || (Array.isArray(v) && v.length === 0)) return '';
    if (expect === 'manifests' && Array.isArray(v)) return dumpAllYaml(v);
    return dumpYaml(v);
  };
  const [text, setText] = React.useState(() => serialize(value));
  const [error, setError] = React.useState<string | null>(null);
  const lastEmitted = React.useRef<string>(JSON.stringify(value ?? null));

  React.useEffect(() => {
    const incoming = JSON.stringify(value ?? null);
    if (incoming !== lastEmitted.current) {
      lastEmitted.current = incoming;
      setText(serialize(value));
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const handleChange = (next: string) => {
    setText(next);
    let parsed: unknown;
    if (expect === 'manifests') {
      const result = parseManifests(next);
      if (result.error !== undefined) {
        setError(result.error);
        return;
      }
      parsed = result.value.length > 0 ? result.value : undefined;
    } else {
      try {
        parsed = next.trim() === '' ? undefined : yaml.load(next);
      } catch (err) {
        setError((err as Error).message);
        return;
      }
      if (parsed !== undefined) {
        if (expect === 'array' && !Array.isArray(parsed)) {
          setError(t('The value must be a YAML list'));
          return;
        }
        if (expect === 'object' && (typeof parsed !== 'object' || Array.isArray(parsed))) {
          setError(t('The value must be a YAML mapping'));
          return;
        }
      }
    }
    setError(null);
    lastEmitted.current = JSON.stringify(parsed ?? null);
    onChange(parsed);
  };

  return (
    <TextField
      fullWidth
      multiline
      minRows={minRows}
      maxRows={30}
      label={label}
      value={text}
      error={!!error}
      helperText={error || helperText}
      onChange={e => handleChange(e.target.value)}
      InputProps={{ sx: { fontFamily: 'monospace', fontSize: '0.85rem' } }}
      inputProps={{ spellCheck: false }}
    />
  );
}
