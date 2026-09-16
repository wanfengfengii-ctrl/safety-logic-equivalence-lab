import { useMemo, useState } from 'react';
import GateGraphSvg from './components/GateGraphSvg';
import { validatePair } from './core/validate';
import { checkEquivalence, type EquivalenceResult } from './core/engine';
import { BddLimitError } from './core/bdd';
import {
  EXAMPLE_DIFFER_NEW,
  EXAMPLE_DIFFER_OLD,
  EXAMPLE_EQUIVALENT_NEW,
  EXAMPLE_EQUIVALENT_OLD,
  EXAMPLE_RARE_NEW,
  EXAMPLE_RARE_OLD,
} from './samples';
import type { GateGraph, GraphError } from './core/types';

type SampleKey = 'equiv' | 'differ' | 'rare';

const SAMPLES: Record<SampleKey, { label: string; old: string; new: string }> = {
  equiv: { label: '示例：德摩根等价', old: EXAMPLE_EQUIVALENT_OLD, new: EXAMPLE_EQUIVALENT_NEW },
  differ: { label: '示例：AND 与 OR', old: EXAMPLE_DIFFER_OLD, new: EXAMPLE_DIFFER_NEW },
  rare: { label: '示例：罕见组合分歧（仅全 1 时翻转）', old: EXAMPLE_RARE_OLD, new: EXAMPLE_RARE_NEW },
};

export default function App() {
  const [oldText, setOldText] = useState('');
  const [newText, setNewText] = useState('');
  // 结论状态：null 表示尚无有效结论（任何错误都清空）
  const [result, setResult] = useState<EquivalenceResult | null>(null);
  const [graphs, setGraphs] = useState<[GateGraph, GateGraph] | null>(null);
  const [errors, setErrors] = useState<GraphError[]>([]);
  const [fatal, setFatal] = useState<string | null>(null);

  const liveValidation = useMemo(() => {
    if (oldText.trim() === '' || newText.trim() === '') {
      return [] as GraphError[];
    }
    return validatePair(oldText, newText).errors;
  }, [oldText, newText]);

  const resetConclusion = () => {
    setResult(null);
    setGraphs(null);
    setErrors([]);
    setFatal(null);
  };

  const loadSample = (key: SampleKey) => {
    setOldText(SAMPLES[key].old);
    setNewText(SAMPLES[key].new);
    resetConclusion();
  };

  const runCheck = () => {
    // 每次运行先清空旧结论与图形（要求：任一错误整次拒绝并清空）
    resetConclusion();
    const { errors: errs, graphs: parsed } = validatePair(oldText, newText);
    setErrors(errs);
    if (errs.length > 0 || !parsed) {
      return;
    }
    try {
      const r = checkEquivalence(parsed[0], parsed[1]);
      setResult(r);
      setGraphs(parsed);
    } catch (e) {
      setFatal(e instanceof BddLimitError ? e.message : `判定失败：${(e as Error).message}`);
    }
  };

  const clearAll = () => {
    setOldText('');
    setNewText('');
    resetConclusion();
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>联锁门图等价性复算工作台</h1>
        <p className="subtitle">
          纯前端 · 自研 ROBDD（唯一表 / 计算表 / 约简 / Apply）· 变量序为全部 INPUT 名 ASCII 升序 ·
          反例直接读取异或根满足赋值摘要，不做全赋值枚举与路径回溯
        </p>
      </header>

      <div className="toolbar">
        {(Object.keys(SAMPLES) as SampleKey[]).map((k) => (
          <button key={k} type="button" className="btn btn-sample" onClick={() => loadSample(k)}>
            {SAMPLES[k].label}
          </button>
        ))}
        <button type="button" className="btn btn-run" onClick={runCheck} data-testid="run-check">
          复算等价性
        </button>
        <button type="button" className="btn btn-clear" onClick={clearAll}>
          清空
        </button>
      </div>

      <section className="editors">
        <EditorPane
          title="旧版图（A）"
          testId="editor-old"
          value={oldText}
          onChange={(v) => {
            setOldText(v);
            resetConclusion();
          }}
          liveErrors={liveValidation.filter((e) => e.graph === 0)}
        />
        <EditorPane
          title="新版图（B）"
          testId="editor-new"
          value={newText}
          onChange={(v) => {
            setNewText(v);
            resetConclusion();
          }}
          liveErrors={liveValidation.filter((e) => e.graph === 1)}
        />
      </section>

      {errors.length > 0 && (
        <section className="error-panel" data-testid="error-panel">
          <h2>输入被整次拒绝（{errors.length} 项，旧图优先、输入位置升序）</h2>
          <ol>
            {errors.map((e, i) => (
              <li key={i} className={`error-item error-${e.code}`}>
                <span className="error-tag">{e.code}</span>
                <span className="error-graph">{e.graphLabel}</span>
                <span>{e.message}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {fatal && (
        <section className="error-panel" data-testid="fatal-panel">
          <h2>判定中止</h2>
          <p>{fatal}</p>
        </section>
      )}

      {result && graphs && <ResultView result={result} oldGraph={graphs[0]} newGraph={graphs[1]} />}

      {!result && errors.length === 0 && !fatal && (
        <section className="placeholder" data-testid="placeholder">
          <p>在双栏粘贴两份门图 JSON，点击「复算等价性」。任一校验错误都会清空旧结论与图形。</p>
        </section>
      )}
    </div>
  );
}

function EditorPane({
  title,
  value,
  onChange,
  testId,
  liveErrors,
}: {
  title: string;
  value: string;
  onChange: (v: string) => void;
  testId: string;
  liveErrors: GraphError[];
}) {
  return (
    <div className="editor-pane">
      <h2>{title}</h2>
      <textarea
        data-testid={testId}
        className="json-input"
        spellCheck={false}
        placeholder={'{"nodes":[{"id":"a","kind":"INPUT","name":"A"},...],"output":"..."}'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <div className="live-status">
        {liveErrors.length > 0 ? (
          <span className="live-bad">本图检出 {liveErrors.length} 项错误</span>
        ) : value.trim() !== '' ? (
          <span className="live-ok">本图静态检查通过</span>
        ) : (
          <span className="live-empty">等待粘贴</span>
        )}
      </div>
    </div>
  );
}

function ResultView({
  result,
  oldGraph,
  newGraph,
}: {
  result: EquivalenceResult;
  oldGraph: GateGraph;
  newGraph: GateGraph;
}) {
  const equivalent = result.verdict === 'equivalent';
  const assignment = result.counterexample;
  const oldValues = new Map(result.oldTrace.map((t) => [t.nodeId, t.value]));
  const newValues = new Map(result.newTrace.map((t) => [t.nodeId, t.value]));

  return (
    <section className="result" data-testid="result-panel">
      <div className={`verdict verdict-${result.verdict}`} data-testid="verdict">
        {equivalent ? '✔ EQUIVALENT — 两图输出函数等价' : '✘ NOT EQUIVALENT — 发现反例'}
      </div>

      <div className="meta-row">
        <span>共享变量（ASCII 升序）：{result.sharedVariables.join(', ') || '（无）'}</span>
        <span>异或根 BDD 节点：{result.miterRoot}</span>
        <span>唯一表节点数：{result.stats.uniqueNodes}</span>
        <span>Apply 递归调用：{result.stats.applyCalls}</span>
      </div>

      {!equivalent && assignment && (
        <div className="counterexample" data-testid="counterexample">
          <h3>唯一反例（直接读取异或根满足赋值摘要，跳过变量补 0）</h3>
          <table>
            <thead>
              <tr>
                {result.variableOrder.map((v) => (
                  <th key={v} className={result.sharedVariables.includes(v) ? '' : 'col-nonshared'}>
                    {v}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                {result.variableOrder.map((v) => (
                  <td key={v} className={assignment[v] === 1 ? 'bit-one' : 'bit-zero'}>
                    {assignment[v]}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
          <p className="ce-outputs">
            旧图输出 = <strong>{result.oldOutput}</strong>，新图输出 = <strong>{result.newOutput}</strong>（已逐门复算）
          </p>
        </div>
      )}

      <div className="graphs">
        <GraphColumn
          title="旧图(A) 复算"
          graph={oldGraph}
          trace={result.oldTrace}
          assignment={assignment}
          values={oldValues}
          outputValue={result.oldOutput}
          testId="graph-old"
        />
        <GraphColumn
          title="新图(B) 复算"
          graph={newGraph}
          trace={result.newTrace}
          assignment={assignment}
          values={newValues}
          outputValue={result.newOutput}
          testId="graph-new"
        />
      </div>
    </section>
  );
}

function GraphColumn({
  title,
  graph,
  trace,
  assignment,
  values,
  outputValue,
  testId,
}: {
  title: string;
  graph: GateGraph;
  trace: EquivalenceResult['oldTrace'];
  assignment: Record<string, 0 | 1> | null;
  values: Map<string, 0 | 1>;
  outputValue: 0 | 1;
  testId: string;
}) {
  return (
    <div className="graph-column">
      <h3>{title}</h3>
      <div className="svg-wrap" data-testid={testId}>
        <GateGraphSvg graph={graph} assignment={assignment} values={values} />
      </div>
      <div className="trace-block">
        <h4>逐门复算（按粘贴位置升序）</h4>
        <table className="trace-table" data-testid={`${testId}-trace`}>
          <thead>
            <tr>
              <th>#</th>
              <th>id</th>
              <th>类型</th>
              <th>入边</th>
              <th>BDD#</th>
              <th>输出</th>
            </tr>
          </thead>
          <tbody>
            {trace.map((t, i) => (
              <tr key={t.nodeId}>
                <td>{i}</td>
                <td>{t.nodeId}</td>
                <td>{t.kind}</td>
                <td>{t.inputs.join(', ')}</td>
                <td>{t.bddNode}</td>
                <td className={t.value === 1 ? 'bit-one' : 'bit-zero'}>{t.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="final-output">
        指定输出电平：
        <strong className={outputValue === 1 ? 'bit-one' : 'bit-zero'}>{outputValue}</strong>
      </p>
    </div>
  );
}
