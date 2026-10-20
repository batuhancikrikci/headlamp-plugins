/** Prefix of the annotations Inference Hub writes. */
export const ANNOTATION_PREFIX = 'inference-hub.batuhancikrikci.github.io/';

/** Reads an Inference Hub annotation (`name` without prefix). */
export function readAnnotation(
  annotations: Record<string, string> | undefined,
  name: string
): string | undefined {
  return annotations?.[ANNOTATION_PREFIX + name];
}
