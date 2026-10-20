import { fireEvent, render, screen, within } from '@testing-library/react';
import React from 'react';
import { ExpandableTable } from './ExpandableTable';

interface Node {
  name: string;
  models: number;
}

const rows: Node[] = [
  { name: 'gpu-node-02', models: 1 },
  { name: 'gpu-node-01', models: 3 },
];

function renderTable() {
  return render(
    <ExpandableTable<Node>
      rows={rows}
      getRowId={r => r.name}
      columns={[
        { id: 'name', header: 'Node', value: r => r.name },
        { id: 'models', header: 'Models', value: r => r.models },
      ]}
      renderDetail={r => <span>details of {r.name}</span>}
    />
  );
}

describe('ExpandableTable', () => {
  it('keeps every row aligned with the header (regression: shifted columns)', () => {
    renderTable();
    const [head, ...body] = screen.getAllByRole('row');
    const headerCells = within(head).getAllByRole('columnheader').length;
    // Data rows have the same number of cells as the header (expand cell + columns).
    const dataRows = body.filter(r => within(r).queryAllByRole('cell').length > 1);
    expect(dataRows).toHaveLength(2);
    dataRows.forEach(r => expect(within(r).getAllByRole('cell')).toHaveLength(headerCells));
    // Values land in their own column.
    expect(within(dataRows[0]).getAllByRole('cell')[1].textContent).toContain('gpu-node-01');
    expect(within(dataRows[0]).getAllByRole('cell')[2].textContent).toContain('3');
  });

  it('expands and collapses details below a row', () => {
    renderTable();
    expect(screen.queryByText('details of gpu-node-01')).toBeNull();
    const [first] = screen.getAllByRole('button', { name: 'Expand details' });
    fireEvent.click(first);
    expect(screen.getByText('details of gpu-node-01')).toBeTruthy();
    expect(first.getAttribute('aria-expanded')).toBe('true');
  });

  it('sorts by a column when its header is clicked', () => {
    renderTable();
    fireEvent.click(screen.getByText('Models'));
    const firstDataRow = screen
      .getAllByRole('row')
      .filter(r => within(r).queryAllByRole('cell').length > 1)[0];
    expect(firstDataRow.textContent).toContain('gpu-node-02');
  });
});
