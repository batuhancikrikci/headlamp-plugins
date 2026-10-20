import { describe, expect, it } from 'vitest';
import { arrangeEditActions } from './headerActions';

const ids = { edit: 'EDIT', delete: 'DELETE' };
const a = (id: string) => ({ id });
const order = (list: Array<{ id: string }>) => list.map(x => x.id);

describe('arrangeEditActions', () => {
  it('orders form edit, YAML edit, delete', () => {
    const result = arrangeEditActions([a('EDIT'), a('DELETE')], ids, a('YAML'), a('FORM'));
    expect(order(result)).toEqual(['FORM', 'YAML', 'DELETE']);
  });

  it('keeps other actions in place', () => {
    const result = arrangeEditActions(
      [a('VIEW'), a('EDIT'), a('DELETE'), a('DOWNLOAD')],
      ids,
      a('YAML'),
      a('FORM')
    );
    expect(order(result)).toEqual(['VIEW', 'FORM', 'YAML', 'DELETE', 'DOWNLOAD']);
  });

  it('only replaces the edit action when there is no form edit', () => {
    expect(order(arrangeEditActions([a('EDIT'), a('DELETE')], ids, a('YAML')))).toEqual([
      'YAML',
      'DELETE',
    ]);
  });

  it('puts the form edit before delete when there is no default edit', () => {
    expect(order(arrangeEditActions([a('DELETE')], ids, a('YAML'), a('FORM')))).toEqual([
      'FORM',
      'DELETE',
    ]);
    expect(order(arrangeEditActions([], ids, a('YAML'), a('FORM')))).toEqual(['FORM']);
  });
});
