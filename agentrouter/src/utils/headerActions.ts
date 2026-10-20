/**
 * Ordering of detail-view header actions for plugin resources.
 * Target order: [edit with form] [edit YAML] [delete] (other actions keep their place).
 * Pure, unit tested.
 */
export interface HeaderActionLike {
  id: string;
}

export function arrangeEditActions<T extends HeaderActionLike>(
  actions: T[],
  ids: { edit: string; delete: string },
  editAction: T,
  formAction?: T
): T[] {
  const result: T[] = [];
  let formPlaced = !formAction;
  for (const action of actions) {
    if (action.id === ids.edit) {
      if (!formPlaced) result.push(formAction!);
      formPlaced = true;
      result.push(editAction);
      continue;
    }
    // No default Edit action (e.g. removed elsewhere): keep the form edit before Delete.
    if (action.id === ids.delete && !formPlaced) {
      result.push(formAction!);
      formPlaced = true;
    }
    result.push(action);
  }
  if (!formPlaced) result.push(formAction!);
  return result;
}
