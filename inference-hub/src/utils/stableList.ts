/**
 * Keeps the objects of a list that is rebuilt on every refresh: an item equal to the one with the
 * same id in the previous list is replaced by that previous object, and an unchanged list is the
 * previous array itself. Pickers then keep their search text and highlight across refreshes.
 */
export function reuseUnchanged<T extends { id: string }>(previous: T[], next: T[]): T[] {
  const byId = new Map(previous.map(item => [item.id, item]));
  let changed = previous.length !== next.length;
  const merged = next.map((item, i) => {
    const old = byId.get(item.id);
    if (old && JSON.stringify(old) === JSON.stringify(item)) {
      if (previous[i] !== old) changed = true;
      return old;
    }
    changed = true;
    return item;
  });
  return changed ? merged : previous;
}
