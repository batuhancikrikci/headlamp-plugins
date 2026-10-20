/** "namespace/name" identifier used for instance selection and settings. */
export function instanceKey(o: { metadata: { name: string; namespace?: string } }): string {
  return `${o.metadata.namespace || ''}/${o.metadata.name}`;
}
