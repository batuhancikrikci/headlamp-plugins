import { CiliumObject } from './base';
import { isNamespacedKind } from './kinds';
import {
  CIDRGroupInterface,
  NetworkPolicyInterface,
  PolicyFeatures,
  policyFeatures,
  PolicyRule,
  policyRules,
  PolicyValidity,
  policyValidity,
} from './models/policy';

export * from './models/policy';

class PolicyBase extends CiliumObject<NetworkPolicyInterface> {
  get rules(): PolicyRule[] {
    return policyRules(this.jsonData);
  }

  get features(): PolicyFeatures {
    return policyFeatures(this.rules);
  }

  get validity(): PolicyValidity {
    return policyValidity(this.conditions);
  }
}

export class CiliumNetworkPolicy extends PolicyBase {
  static kind = 'CiliumNetworkPolicy';
  static apiName = 'ciliumnetworkpolicies';
  static isNamespaced = isNamespacedKind('CiliumNetworkPolicy');

  static get detailsRoute() {
    return 'cilium-ciliumnetworkpolicies-detail';
  }
}

export class CiliumClusterwideNetworkPolicy extends PolicyBase {
  static kind = 'CiliumClusterwideNetworkPolicy';
  static apiName = 'ciliumclusterwidenetworkpolicies';
  static isNamespaced = isNamespacedKind('CiliumClusterwideNetworkPolicy');

  static get detailsRoute() {
    return 'cilium-ciliumclusterwidenetworkpolicies-detail';
  }
}

export class CiliumCIDRGroup extends CiliumObject<CIDRGroupInterface> {
  static kind = 'CiliumCIDRGroup';
  static apiName = 'ciliumcidrgroups';
  static isNamespaced = isNamespacedKind('CiliumCIDRGroup');

  static get detailsRoute() {
    return 'cilium-ciliumcidrgroups-detail';
  }

  get cidrs(): string[] {
    return this.spec.externalCIDRs || [];
  }
}
