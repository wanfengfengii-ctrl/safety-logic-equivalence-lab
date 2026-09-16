import { expect, test } from '@playwright/test';

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

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('页面结构：双栏 JSON 输入与复算按钮', async ({ page }) => {
  await expect(page).toHaveTitle(/联锁/);
  await expect(page.getByTestId('editor-old')).toBeVisible();
  await expect(page.getByTestId('editor-new')).toBeVisible();
  await expect(page.getByTestId('run-check')).toBeVisible();
});

test('等价门图：AND 与德摩根实现判定 equivalent，渲染双图 SVG', async ({ page }) => {
  await page.getByTestId('editor-old').fill(AND_AB);
  await page.getByTestId('editor-new').fill(DE_MORGAN);
  await page.getByTestId('run-check').click();

  await expect(page.getByTestId('verdict')).toContainText('EQUIVALENT');
  await expect(page.getByText(/异或根 BDD 节点：0(?!\d)/)).toBeVisible();
  await expect(page.getByTestId('counterexample')).toHaveCount(0);
  expect(await page.getByTestId('graph-old').locator('svg g[data-node-id]').count()).toBe(3);
  expect(await page.getByTestId('graph-new').locator('svg g[data-node-id]').count()).toBe(6);
  // 两张逐门复算表
  await expect(page.getByTestId('graph-old-trace')).toBeVisible();
  await expect(page.getByTestId('graph-new-trace')).toBeVisible();
});

test('反例：AND vs OR，直接读出 A=0 B=1', async ({ page }) => {
  await page.getByText('示例：AND 与 OR').click();
  await page.getByTestId('run-check').click();

  await expect(page.getByTestId('verdict')).toContainText('NOT EQUIVALENT');
  const bits = page.getByTestId('counterexample').locator('tbody td');
  await expect(bits).toHaveText(['0', '1']);
  await expect(page.getByTestId('counterexample')).toContainText('旧图输出 = 0');
  await expect(page.getByTestId('counterexample')).toContainText('新图输出 = 1');
});

test('罕见组合示例：仅全 1 分歧', async ({ page }) => {
  await page.getByText('罕见组合分歧').click();
  await page.getByTestId('run-check').click();
  await expect(page.getByTestId('verdict')).toContainText('NOT EQUIVALENT');
  const bits = await page.getByTestId('counterexample').locator('tbody td').allTextContents();
  expect(bits).toEqual(['1', '1', '1']);
});

test('错误输入整次拒绝：环错误清空结论与图形', async ({ page }) => {
  // 先得到一个有效结论
  await page.getByText('示例：德摩根等价').click();
  await page.getByTestId('run-check').click();
  await expect(page.getByTestId('verdict')).toContainText('EQUIVALENT');

  // 制造环
  await page
    .getByTestId('editor-old')
    .fill(JSON.stringify({ nodes: [{ id: 'g', kind: 'NOT', inputs: ['g'] }], output: 'g' }));
  await page.getByTestId('run-check').click();

  await expect(page.getByTestId('error-panel')).toBeVisible();
  await expect(page.getByTestId('result-panel')).toHaveCount(0);
  await expect(page.getByTestId('error-panel')).toContainText('CYCLE');
  await expect(page.getByTestId('error-panel')).toContainText('旧图(A)');
});

test('多种错误按旧图优先、位置升序汇总并一次性展示', async ({ page }) => {
  await page.getByTestId('editor-old').fill('{ broken');
  await page
    .getByTestId('editor-new')
    .fill(JSON.stringify({ nodes: [{ id: 'x', kind: 'INPUT', name: 'X' }], output: 'nope' }));
  await page.getByTestId('run-check').click();

  const items = page.getByTestId('error-panel').locator('li');
  await expect(items.first()).toContainText('旧图(A)');
  await expect(items.first()).toContainText('SYNTAX');
  await expect(items.last()).toContainText('新图(B)');
});

test('纯前端：无任何业务后端/在线服务请求', async ({ page }) => {
  const external: string[] = [];
  page.on('request', (req) => {
    const u = new URL(req.url());
    // 放行同源静态资源（HTML/JS/CSS/favicon）；任何跨源请求都视为外联
    if (u.origin !== new URL(page.url()).origin) external.push(req.url());
  });
  await page.getByText('示例：德摩根等价').click();
  await page.getByTestId('run-check').click();
  await expect(page.getByTestId('verdict')).toContainText('EQUIVALENT');
  expect(external).toEqual([]);
});

function chainGraphs(): [string, string] {
  // 8000 级串联非门，两图完全相同
  const depth = 8000;
  const nodes: unknown[] = [{ id: 'x0', kind: 'INPUT', name: 'A' }];
  for (let i = 1; i <= depth; i += 1) {
    nodes.push({ id: `n${i}`, kind: 'NOT', inputs: [i === 1 ? 'x0' : `n${i - 1}`] });
  }
  const json = JSON.stringify({ nodes, output: `n${depth}` });
  return [json, json];
}

function xorChainJson(): string {
  const n = 500;
  const nodes: unknown[] = [];
  for (let i = 0; i < n; i += 1) {
    nodes.push({ id: `x${i}`, kind: 'INPUT', name: `X${String(i).padStart(3, '0')}` });
  }
  nodes.push({ id: 'p1', kind: 'XOR', inputs: ['x0', 'x1'] });
  for (let i = 2; i < n; i += 1) {
    nodes.push({ id: `p${i}`, kind: 'XOR', inputs: [`p${i - 1}`, `x${i}`] });
  }
  return JSON.stringify({ nodes, output: `p${n - 1}` });
}

test('大规模：500 输入异或链两图相同判 equivalent（不触发节点上限）', async ({ page }) => {
  const json = xorChainJson();
  await page.getByTestId('editor-old').fill(json);
  await page.getByTestId('editor-new').fill(json);
  await page.getByTestId('run-check').click();
  await expect(page.getByTestId('verdict')).toContainText('EQUIVALENT', { timeout: 30000 });
  await expect(page.getByTestId('fatal-panel')).toHaveCount(0);
});

test('大规模：8000 非门链不栈溢出，判 equivalent', async ({ page }) => {
  const [oldJ, newJ] = chainGraphs();
  await page.getByTestId('editor-old').fill(oldJ);
  await page.getByTestId('editor-new').fill(newJ);
  await page.getByTestId('run-check').click();
  await expect(page.getByTestId('verdict')).toContainText('EQUIVALENT', { timeout: 30000 });
  await expect(page.getByTestId('fatal-panel')).toHaveCount(0);
});

test('同名 INPUT：共享变量栏只列一次 A', async ({ page }) => {
  const oldG = JSON.stringify({
    nodes: [
      { id: 'a1', kind: 'INPUT', name: 'A' },
      { id: 'g', kind: 'NOT', inputs: ['a1'] },
    ],
    output: 'g',
  });
  const newG = JSON.stringify({
    nodes: [
      { id: 'a1', kind: 'INPUT', name: 'A' },
      { id: 'a2', kind: 'INPUT', name: 'A' },
      { id: 'g1', kind: 'NOT', inputs: ['a1'] },
      { id: 'g2', kind: 'NOT', inputs: ['a2'] },
      { id: 'o', kind: 'AND', inputs: ['g1', 'g2'] },
    ],
    output: 'o',
  });
  await page.getByTestId('editor-old').fill(oldG);
  await page.getByTestId('editor-new').fill(newG);
  await page.getByTestId('run-check').click();
  await expect(page.getByTestId('verdict')).toContainText('EQUIVALENT');
  const meta = page.locator('.meta-row');
  await expect(meta).toContainText('共享变量（ASCII 升序）：A');
  await expect(meta).not.toContainText('A、A');
});
