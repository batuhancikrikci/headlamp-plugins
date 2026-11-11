import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// Headlamp's resource classes are the external dependency: a class only builds the details path.
vi.mock('@kinvolk/headlamp-plugin/lib', () => {
  class Fake {
    static apiVersion = 'v1';
    static isNamespaced = true;
    jsonData: { metadata: { name: string; namespace?: string } };
    constructor(json: { metadata: { name: string; namespace?: string } }) {
      this.jsonData = json;
    }
    getDetailsLink() {
      const { name, namespace } = this.jsonData.metadata;
      return `/c/test/services/${namespace}/${name}`;
    }
  }
  return { K8s: { ResourceClasses: { Service: Fake } } };
});
// Headlamp's Link puts the object it gets into its cache, so the details page would render a
// name-only object (the crash this guards against). It must not be used for these references.
vi.mock('@kinvolk/headlamp-plugin/lib/CommonComponents', () => ({
  Link: () => {
    throw new Error("Headlamp's Link must not be used for name-only references");
  },
}));
vi.mock('../../resources/registry', () => ({ crdByKind: () => undefined }));

import { ResourceRefLink } from './ResourceRefLink';

describe('ResourceRefLink', () => {
  it('links to the details page without handing over the name-only object', () => {
    render(
      <MemoryRouter>
        <ResourceRefLink kind="Service" name="web" namespace="shop" />
      </MemoryRouter>
    );
    expect(screen.getByText('web').closest('a')?.getAttribute('href')).toBe(
      '/c/test/services/shop/web'
    );
  });
});
