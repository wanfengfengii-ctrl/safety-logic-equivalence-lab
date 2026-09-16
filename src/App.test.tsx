import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import App from './App';

const AND_AB = JSON.stringify({
  nodes: [
    { id: 'a', kind: 'INPUT', name: 'A' },
    { id: 'b', kind: 'INPUT', name: 'B' },
    { id: 'g', kind: 'AND', inputs: ['a', 'b'] },
  ],
  output: 'g',
});

const DE_MORGAN = JSON.stringify({
  nodes: [
    { id: 'x', kind: 'INPUT', name: 'A' },
    { id: 'y', kind: 'INPUT', name: 'B' },
    { id: 'nx', kind: 'NOT', inputs: ['x'] },
    { id: 'ny', kind: 'NOT', inputs: ['y'] },
    { id: 'o', kind: 'OR', inputs: ['nx', 'ny'] },
    { id: 'out', kind: 'NOT', inputs: ['o'] },
  ],
  output: 'out',
});

const OR_AB = JSON.stringify({
  nodes: [
    { id: 'p', kind: 'INPUT', name: 'A' },
    { id: 'q', kind: 'INPUT', name: 'B' },
    { id: 'g', kind: 'OR', inputs: ['p', 'q'] },
  ],
  output: 'g',
});

function pasteBoth(oldText: string, newText: string) {
  fireEvent.change(screen.getByTestId('editor-old'), { target: { value: oldText } });
  fireEvent.change(screen.getByTestId('editor-new'), { target: { value: newText } });
}

describe('App 工作台', () => {
  it('等价门图显示 EQUIVALENT，异或根为 0', () => {
    render(<App />);
    pasteBoth(AND_AB, DE_MORGAN);
    fireEvent.click(screen.getByTestId('run-check'));

    const verdict = screen.getByTestId('verdict');
    expect(verdict).toHaveTextContent('EQUIVALENT');
    expect(screen.getByText(/异或根 BDD 节点：0/)).toBeInTheDocument();
    expect(screen.queryByTestId('counterexample')).not.toBeInTheDocument();
    // 两栏 SVG 图形均渲染
    expect(screen.getByTestId('graph-old').querySelector('svg')).not.toBeNull();
    expect(screen.getByTestId('graph-new').querySelector('svg')).not.toBeNull();
  });

  it('分歧门图显示反例 A=0,B=1 与两图输出 0/1，并逐门复算', () => {
    render(<App />);
    pasteBoth(AND_AB, OR_AB);
    fireEvent.click(screen.getByTestId('run-check'));

    expect(screen.getByTestId('verdict')).toHaveTextContent('NOT EQUIVALENT');
    const ce = screen.getByTestId('counterexample');
    const cells = within(ce).getAllByRole('cell');
    expect(cells.map((c) => c.textContent)).toEqual(['0', '1']);
    expect(ce).toHaveTextContent('旧图输出 = 0');
    expect(ce).toHaveTextContent('新图输出 = 1');
  });

  it('任一错误整次拒绝，并清空旧结论与图形', () => {
    render(<App />);
    pasteBoth(AND_AB, DE_MORGAN);
    fireEvent.click(screen.getByTestId('run-check'));
    expect(screen.getByTestId('verdict')).toHaveTextContent('EQUIVALENT');

    // 将旧图改为环结构后重新复算
    const cyclic = JSON.stringify({
      nodes: [{ id: 'g', kind: 'NOT', inputs: ['g'] }],
      output: 'g',
    });
    fireEvent.change(screen.getByTestId('editor-old'), { target: { value: cyclic } });
    fireEvent.click(screen.getByTestId('run-check'));

    expect(screen.getByTestId('error-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('result-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('graph-old')).not.toBeInTheDocument();
    expect(screen.getByText(/CYCLE/)).toBeInTheDocument();
  });

  it('错误按旧图优先展示', () => {
    render(<App />);
    const badOld = JSON.stringify({
      nodes: [{ id: 'a', kind: 'INPUT', name: 'bad-name' }],
      output: 'a',
    });
    const badNew = JSON.stringify({
      nodes: [{ id: 'x', kind: 'INPUT', name: 'X' }],
      output: 'missing',
    });
    pasteBoth(badOld, badNew);
    fireEvent.click(screen.getByTestId('run-check'));
    const items = within(screen.getByTestId('error-panel')).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('旧图(A)');
    expect(items[items.length - 1]).toHaveTextContent('新图(B)');
  });

  it('清空按钮移除输入与结论', () => {
    render(<App />);
    pasteBoth(AND_AB, DE_MORGAN);
    fireEvent.click(screen.getByTestId('run-check'));
    fireEvent.click(screen.getByText('清空'));
    expect(screen.queryByTestId('result-panel')).not.toBeInTheDocument();
    expect(screen.getByTestId('placeholder')).toBeInTheDocument();
  });
});
