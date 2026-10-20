/**
 * Short introductions and upstream documentation links shown at the top of the documentation
 * of a kind. Each plugin registers its own kinds once, from `index.tsx`.
 */
export interface KindDoc {
  summary: string;
  url?: string;
}

const registry = new Map<string, KindDoc>();

/** Adds (or replaces) the introductions of the given kinds. */
export function registerKindDocs(docs: Record<string, KindDoc>) {
  for (const [kind, doc] of Object.entries(docs)) registry.set(kind, doc);
}

/** The introduction of a kind, if the plugin registered one. */
export function kindDoc(kind: string | undefined): KindDoc | undefined {
  return kind ? registry.get(kind) : undefined;
}
