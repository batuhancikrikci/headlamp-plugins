import { scaledSize } from './images';
import { cosine, norm, similarityMatrix } from './vectors';

describe('vectors', () => {
  it('computes the cosine similarity', () => {
    expect(cosine([1, 0], [1, 0])).toBe(1);
    expect(cosine([1, 0], [0, 1])).toBe(0);
    expect(cosine([1, 0], [-1, 0])).toBe(-1);
    expect(cosine([0, 0], [1, 0])).toBe(0);
  });

  it('builds a symmetric matrix', () => {
    const m = similarityMatrix([
      [1, 0],
      [1, 1],
    ]);
    expect(m[0][0]).toBe(1);
    expect(m[0][1]).toBeCloseTo(Math.SQRT1_2);
    expect(m[1][0]).toBe(m[0][1]);
    expect(norm([3, 4])).toBe(5);
  });
});

describe('scaledSize', () => {
  it('keeps small images and the aspect ratio of large ones', () => {
    expect(scaledSize(800, 600)).toEqual({ width: 800, height: 600 });
    expect(scaledSize(4000, 3000)).toEqual({ width: 1536, height: 1152 });
    expect(scaledSize(1000, 3072)).toEqual({ width: 500, height: 1536 });
  });
});
