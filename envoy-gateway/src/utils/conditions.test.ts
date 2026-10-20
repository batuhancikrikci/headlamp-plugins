import { describe, expect, it } from 'vitest';
import { getPrimaryCondition, statusSortValue, summarizeStatus } from './conditions';

const accepted = { type: 'Accepted', status: 'True' };
const rejected = { type: 'Accepted', status: 'False', reason: 'Invalid' };

describe('getPrimaryCondition', () => {
  it('prefers Accepted over other conditions', () => {
    expect(getPrimaryCondition([{ type: 'Other', status: 'True' }, accepted])).toBe(accepted);
  });

  it('falls back to the first condition', () => {
    const other = { type: 'Other', status: 'False' };
    expect(getPrimaryCondition([other])).toBe(other);
  });
});

describe('summarizeStatus', () => {
  it('is unknown without status', () => {
    expect(summarizeStatus(undefined)).toMatchObject({ health: 'unknown', ancestorCount: 0 });
  });

  it('reports a failure on any ancestor, not only the first one', () => {
    const summary = summarizeStatus({
      ancestors: [
        { ancestorRef: { group: 'g', kind: 'Gateway', name: 'a' }, conditions: [accepted] },
        { ancestorRef: { group: 'g', kind: 'Gateway', name: 'b' }, conditions: [rejected] },
      ],
    });
    expect(summary.health).toBe('error');
    expect(summary.primary).toBe(rejected);
    expect(summary.acceptedCount).toBe(1);
    expect(summary.ancestorCount).toBe(2);
  });

  it('uses own conditions for non-policy resources', () => {
    expect(summarizeStatus({ conditions: [accepted] })).toMatchObject({ health: 'success' });
  });

  it('sorts failures first', () => {
    const bad = statusSortValue(summarizeStatus({ conditions: [rejected] }));
    const good = statusSortValue(summarizeStatus({ conditions: [accepted] }));
    expect(bad < good).toBe(true);
  });
});
