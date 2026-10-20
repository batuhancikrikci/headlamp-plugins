import { Discovery } from '../../api/discovery';
import { DeployForm, Errors } from './deployModel';

export interface StepProps {
  form: DeployForm;
  update: (patch: Partial<DeployForm>) => void;
  /** Validation errors; only shown after the user tried to continue. */
  errors: Errors;
  discovery: Discovery;
}

export function fieldError(errors: Errors, key: keyof DeployForm) {
  const message = errors[key];
  return { error: !!message, helperText: message };
}
