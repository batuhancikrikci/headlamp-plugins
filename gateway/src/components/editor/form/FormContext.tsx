/**
 * State shared by every form field: the resource being edited, how to change it, and the
 * validation issues to show.
 *
 * The resource object itself is the single source of truth. The form fields read from it and
 * write back with immutable updates, and the YAML editor parses into the same object; that is
 * what keeps form and YAML in sync without either of them losing data.
 */
import React from 'react';
import { Availability } from '../../../discovery/availability';
import { KubeJson } from '../../../resources/types';
import { getIn, setIn } from '../../../utils/objects';
import { issuesAt, issuesUnder, ValidationIssue } from '../../../utils/validation';

export interface FormContextValue {
  value: KubeJson;
  /** Replaces the whole resource. */
  onChange: (next: KubeJson) => void;
  /** Sets one path; `undefined` removes the field. */
  set: (path: string, fieldValue: unknown) => void;
  /** Applies several changes atomically. */
  update: (fn: (current: KubeJson) => KubeJson) => void;
  get: (path: string) => unknown;
  issues: ValidationIssue[];
  /** Show errors on untouched fields too (after the user tried to continue or apply). */
  showAllErrors: boolean;
  mode: 'create' | 'edit';
  availability: Availability;
}

const FormContext = React.createContext<FormContextValue | null>(null);

export interface FormProviderProps {
  value: KubeJson;
  onChange: (next: KubeJson) => void;
  issues: ValidationIssue[];
  showAllErrors: boolean;
  mode: 'create' | 'edit';
  availability: Availability;
  children: React.ReactNode;
}

export function FormProvider({
  value,
  onChange,
  issues,
  showAllErrors,
  mode,
  availability,
  children,
}: FormProviderProps) {
  // Several fields may update within the same tick (e.g. a picker setting name and namespace).
  // Reading the latest value from a ref keeps those updates from overwriting each other.
  const latest = React.useRef(value);
  latest.current = value;

  const update = React.useCallback(
    (fn: (current: KubeJson) => KubeJson) => {
      const next = fn(latest.current);
      latest.current = next;
      onChange(next);
    },
    [onChange]
  );

  const set = React.useCallback(
    (path: string, fieldValue: unknown) => update(current => setIn(current, path, fieldValue)),
    [update]
  );

  const context = React.useMemo<FormContextValue>(
    () => ({
      value,
      onChange,
      set,
      update,
      get: (path: string) => getIn(value, path),
      issues,
      showAllErrors,
      mode,
      availability,
    }),
    [value, onChange, set, update, issues, showAllErrors, mode, availability]
  );

  return <FormContext.Provider value={context}>{children}</FormContext.Provider>;
}

export function useForm(): FormContextValue {
  const context = React.useContext(FormContext);
  if (!context) throw new Error('Form fields must be rendered inside a FormProvider');
  return context;
}

/**
 * Validation state of one field. Errors appear once the field was touched (blurred) or when the
 * form asks for all errors; warnings are always shown, as they do not block anything.
 */
export function useFieldIssue(path: string): {
  error?: string;
  warning?: string;
  onBlur: () => void;
} {
  const { issues, showAllErrors } = useForm();
  const [touched, setTouched] = React.useState(false);
  const own = issuesAt(issues, path);
  const error = own.find(issue => issue.severity === 'error');
  const warning = own.find(issue => issue.severity === 'warning');
  return {
    error: error && (touched || showAllErrors) ? error.message : undefined,
    warning: warning?.message,
    onBlur: React.useCallback(() => setTouched(true), []),
  };
}

/** Number of errors at or below a path; used for badges on collapsed sections and list items. */
export function useErrorCount(path: string): number {
  const { issues } = useForm();
  return issuesUnder(issues, path).filter(issue => issue.severity === 'error').length;
}
