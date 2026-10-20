import { BackendForm } from './backend/Form';
import { BackendTrafficPolicyForm } from './backendTrafficPolicy/Form';
import { BackendTrafficPolicyWizard } from './backendTrafficPolicy/Wizard';
import { ClientTrafficPolicyForm } from './clientTrafficPolicy/Form';
import { EditingConfig } from './common/form/EditActions';
import { EnvoyExtensionPolicyForm } from './envoyExtensionPolicy/Form';
import { EnvoyPatchPolicyForm } from './envoyPatchPolicy/Form';
import { EnvoyProxyForm } from './envoyProxy/Form';
import { HTTPRouteFilterForm } from './httpRouteFilter/Form';
import { SecurityPolicyForm } from './securityPolicy/Form';
import { SecurityPolicyWizard } from './securityPolicy/Wizard';

/**
 * Guided editors per kind. Wizards are only provided where the configuration is complex enough
 * to benefit from a step-by-step flow; every kind can also be created from YAML.
 */
export const EDITING: Record<string, EditingConfig> = {
  EnvoyProxy: { Form: EnvoyProxyForm },
  ClientTrafficPolicy: { Form: ClientTrafficPolicyForm },
  BackendTrafficPolicy: { Form: BackendTrafficPolicyForm, Wizard: BackendTrafficPolicyWizard },
  SecurityPolicy: { Form: SecurityPolicyForm, Wizard: SecurityPolicyWizard },
  EnvoyExtensionPolicy: { Form: EnvoyExtensionPolicyForm },
  EnvoyPatchPolicy: { Form: EnvoyPatchPolicyForm },
  Backend: { Form: BackendForm },
  HTTPRouteFilter: { Form: HTTPRouteFilterForm },
};
