/** Small vector helpers for the embeddings test of the Playground. */

/** Cosine similarity of two vectors (0 when either has no length). */
export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na > 0 && nb > 0 ? dot / Math.sqrt(na * nb) : 0;
}

/** Cosine similarity of every pair of vectors. */
export function similarityMatrix(vectors: number[][]): number[][] {
  return vectors.map(a => vectors.map(b => cosine(a, b)));
}

/** Euclidean length; about 1 for models that normalize their embeddings. */
export function norm(vector: number[]): number {
  return Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
}
