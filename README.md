# 联锁门图等价性复算工作台

纯前端（TypeScript + React + Vite + SVG）双栏门图等价性工作台。两版联锁控制器门图
粘贴进左右两栏，工具自行实现 **ROBDD** 给出可复算的等价结论，或在输出分歧时
**直接读出唯一反例**，并对两图逐门电平复算。

- **无业务后端、无在线服务、无外部 CDN**：判定全部在浏览器内完成，构建产物为纯静态文件。
- **无现成 BDD 库**：唯一表、计算表、R1/R2 约简、Apply、否定均在 `src/core/bdd.ts` 自行实现。
- **禁止全赋值枚举**：生产代码不做 2ⁿ 真值展开；单元测试中的真值表仅作为小规模预言机。
- **可扩展**：编译/求值/校验环检测/分层布局全部使用显式栈迭代，万级串联门链不栈溢出；
  相同门图的 miter 经幂等短路立即为 0。

## 快速开始

```bash
npm ci
npm run dev          # 本地开发 http://localhost:5173
npm run test:unit    # Vitest 单元/组件测试
npm run build        # 类型检查 + 产出 dist/
npx playwright test  # 对 dist 跑 Playwright（首次需 npx playwright install chromium）
npm run verify       # 单元测试 + Playwright 一键验收
```

## Docker Compose

```bash
docker compose build

# 静态站点；宿主机端口可用 WEB_PORT 覆盖（默认 8080）
WEB_PORT=9090 docker compose up -d web
# 浏览器打开 http://localhost:9090

# 一次性验收服务：vitest → 类型检查/构建 → 等待 web 健康 → Playwright E2E
docker compose run --rm verify
```

`verify` 是**一次性**服务（`restart: "no"`）：全部通过则退出码 0，任一环节失败非零退出，
适合 CI 或功能安全评审前的可复现验收。它在 Compose 网络内通过
`BASE_URL=http://web:8080` 访问静态容器，不依赖宿主机端口。

## 门图 JSON 格式

```json
{
  "nodes": [
    { "id": "a", "kind": "INPUT", "name": "A" },
    { "id": "b", "kind": "INPUT", "name": "B" },
    { "id": "g", "kind": "AND", "inputs": ["a", "b"] }
  ],
  "output": "g"
}
```

| 规则 | 说明 |
| --- | --- |
| 节点 id | 同一图内唯一，非空字符串 |
| INPUT 名 | 匹配 `^[A-Z][A-Z0-9_]{0,15}$`（1–16 字符）；跨图同名 INPUT 视为同一变量 |
| 节点类型 | 仅 `INPUT`、`CONST0`、`CONST1`、`NOT`、`AND`、`OR`、`XOR` |
| 元数 | INPUT/CONST0/CONST1 无入边；NOT 恰好 1 条；AND/OR/XOR 恰好 2 条（按数组位置区分两个输入） |
| 输出 | 顶层 `output` 必须指向 nodes 中已有的某个 id |
| 拓扑 | 必须为 DAG（Tarjan SCC 检测自环与多节点环）；允许前向引用 |

### 校验错误类别与汇总顺序

类别：`SYNTAX`、`DUPLICATE_ID`、`UNKNOWN_REF`、`ARITY`、`OUTPUT`、`CYCLE`。

错误**汇总而非遇错即停**，排序键为：

1. **旧图（A 栏）优先于新图（B 栏）**；
2. 同图内按**输入位置（JSON 中 nodes 下标）升序**；
3. 同位置按错误类别、再按入边槽位（第 0/1 条入边）升序。

**任一错误即整次拒绝**：不产出结论，并清空上一次的结论面板与两幅 SVG 图形。

## 判定算法

### 变量序

取两图全部 INPUT 名的并集，按 **ASCII 升序**排列；因此两图共享变量天然是该全序中的
ASCII 升序子序列。非共享变量同样参与排序（若未挂接到输出，在 ROBDD 中被 R1 约简消去，
反例摘要中补 0；若真实影响函数，则会作为反例的一部分暴露，避免漏判）。

### ROBDD（`src/core/bdd.ts`）

- 终端 0/1 保留为节点 id 0/1；内部节点为 `(varIndex, low, high)`。
- **唯一表**：`varIndex|low|high` → 节点 id，保证同构节点唯一（R2）。
- **计算表**：`op|f|g` → Apply 结果，记忆化 Shannon 递归，递归每层严格推进到序中下一变量。
- **建点 `mk` 约简**：`low === high` 时直接返回该分支（R1 冗余判定消去），否则查唯一表/建点。
- **否定**：沿树交换 0/1 终端后经 `mk` 重建，双向缓存保证 `¬(¬f) === f`。
- **幂等短路**：`XOR(f,f)=0`、`AND/OR(f,f)=f`，两份完全相同门图的 miter 立即归约为 0。
- `negate`/`apply`/门图编译/逐门求值/环检测/分层布局均为**显式栈迭代**实现，
  数千~数万级串联门不会栈溢出。
- 节点数设有上限（`MAX_BDD_NODES = 2_000_000`），超限抛出 `BddLimitError`，
  防止中间 BDD 异常膨胀。

### 满足赋值摘要不变量（核心）

每个唯一化内部节点在 `mk` 时同步确定一条到 1 终端的**最小满足赋值摘要链**
`satParent`（每节点 O(1) 存储，避免 O(节点数 × 变量数) 内存）：

- 终端 1 为链终点（函数已被满足）；
- 节点规则：**低分支可满足（`low !== 0`）时取低分支**，`satParent = low`（本变量取 0）；
  **否则取高分支**，`satParent = high`（本变量取 1）；
- 读取时从该节点沿 `satParent` 展开到 1 终端，途经变量写入取值，
  链上被跳过（R1 消去或本就不判定）的变量一律保持 **0**。

下降路径在 `mk` 建点时已唯一确定，读取只是把**既定链式摘要展开**，
不是路径搜索或回溯。因为摘要只在 `mk` 中随 R1/R2 一起确定与复用，
Apply 与否定的结果全部来自 `mk`，所以该不变量在建点与任何约简后都保持成立
（单元测试对全部合成节点逐一核验：摘要必使本节点函数求值为 1）。

### 等价判定与反例

1. 分别按 DAG 记忆化**迭代后序**把两图编译为同一管理器内的 ROBDD（共享唯一表）；
2. 构造 miter：`XOR(旧图输出, 新图输出)`；
3. **异或根为 0 终端 ⇒ `equivalent`**；
4. 否则函数可满足，**直接读取异或根节点的 `sat` 摘要作为唯一反例**——
   不编写、也不需要任何路径搜索或回溯算法；
5. 用该赋值对两图从 INPUT/CONST 起**逐门具体复算**电平（界面表格按粘贴位置升序列出
   每个门的输入、BDD 节点号与输出值），并断言旧/新输出确实分歧，否则视为内部错误中止。

界面上：反例位为 1 的共享输入高亮；两幅 SVG 门图按该电平着色（通电门不透明、
失电门半透明，门右侧圆点即该门复算输出），可人工逐门复核。

## 项目结构

```
src/
  core/
    types.ts          门图/错误领域模型
    validate.ts       JSON 解析、全部结构校验、Tarjan 环检测、错误排序
    bdd.ts            自研 ROBDD：唯一表/计算表/约简/Apply/否定 + sat 摘要不变量
    engine.ts         编译两图、XOR miter、读摘要反例、逐门复算
    layout.ts         SVG 分层布局
    *.test.ts         Vitest 单元测试（60+ 例）
  components/GateGraphSvg.tsx   SVG 门图（AND/OR 身形、NOT 取反圈、电平着色）
  App.tsx             双栏粘贴、错误面板、结论/反例/逐门复算
  samples.ts          内置示例（等价、直接分歧、仅全 1 罕见组合分歧）
e2e/app.spec.ts       Playwright 端到端验收
docker/verify-entrypoint.sh  一次性验收流程
nginx/default.conf    静态站点配置（容器内 8080）
```

## 内置示例

- **德摩根等价**：`A·B` 与 `¬(¬A ∨ ¬B)`，应判定 `EQUIVALENT`，异或根为 0；
- **AND 与 OR**：摘要反例 `A=0, B=1`；
- **罕见组合分歧**：多数表决与“额外异或 `A·B·C`”的改版仅在 **A=B=C=1** 时输出不同，
  演示改版后只在罕见输入组合上分歧的场景，摘要沿高分支直接读出 `111`。
