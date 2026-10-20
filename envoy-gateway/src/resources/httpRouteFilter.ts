import { EnvoyGatewayObject, EnvoyGatewayObjectInterface } from './base';

export interface HTTPRouteFilterInterface extends EnvoyGatewayObjectInterface {
  spec?: {
    urlRewrite?: {
      hostname?: {
        type?: 'Header' | 'Backend' | string;
        header?: string;
      };
      path?: {
        type?: 'ReplaceRegexMatch' | string;
        replaceRegexMatch?: {
          pattern?: string;
          substitution?: string;
        };
      };
    };
    directResponse?: {
      contentType?: string;
      statusCode?: number;
      body?: {
        type?: 'Inline' | 'ValueRef' | string;
        inline?: string;
        valueRef?: {
          group?: string;
          kind?: string;
          name: string;
        };
      };
    };
    credentialInjection?: {
      header?: string;
      overwrite?: boolean;
      credential?: {
        valueRef?: { group?: string; kind?: string; name: string };
      };
    };
  };
}

export type FilterType = 'URLRewrite' | 'DirectResponse' | 'CredentialInjection' | 'Unknown';

export class HTTPRouteFilter extends EnvoyGatewayObject<HTTPRouteFilterInterface> {
  static kind = 'HTTPRouteFilter';
  static apiName = 'httproutefilters';

  static get detailsRoute() {
    return 'eg-httproutefilter-detail';
  }

  get filterTypes(): FilterType[] {
    const types: FilterType[] = [];
    if (this.spec.urlRewrite) types.push('URLRewrite');
    if (this.spec.directResponse) types.push('DirectResponse');
    if (this.spec.credentialInjection) types.push('CredentialInjection');
    return types.length > 0 ? types : ['Unknown'];
  }
}
