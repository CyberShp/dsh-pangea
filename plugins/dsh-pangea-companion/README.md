# dsh-pangea-companion

`dsh-pangea-companion` 是 PANGEA 在 DeepSeek Harness 中的只读伴生工作台。

它不创建 Contract、不推进 PANGEA phase、不派发 analysis/review/rework worker，也不改写 `progress.json`、`agent-tasks/`、`agent-results/`、`final-state.json` 或报告。PANGEA 仍是唯一工作流真相；Companion 只读取 Run 状态和结构化产物，让 DSH 更容易观察、查询和浏览分析过程。

## 当前能力

- 自动从当前 DSH workspace 向上发现 `pangea-data/runs/`。
- `pangea_status`：读取当前或指定 Run 的阶段、质量状态、分析进度、风险/用例/证据数量和读取健康状态，模型侧输出中文。
- 自动选择最新的非终态 Run；没有活动 Run 时回退到最新 Run。
- 当前 Run 返回结构化明细：风险、测试用例、证据、业务流程、复核问题；历史 Run 保持轻量摘要。
- 建立 `风险 ↔ 测试用例 ↔ 证据` 关联，便于从风险追到测试和源码证据，再按访问路径返回。
- 只读同源接口 `GET /api/pangea-companion/state`，供 Web UI 使用。
- 检测到 `dsh-better-sidebar` 时，注册单实例 `PANGEA` Tab。
- `dsh-better-sidebar` 是可选 peer dependency；未安装时 Host 工具与只读 Core 仍可工作。

## 数据读取规则

Companion 不把 `progress.completed_* + agent-results/` 当成所有 Run 的唯一数据来源。

读取顺序固定为：

1. **存在 `final-state.json` 且包含聚合结果时，优先读取 `final-state.json`。** PANGEA 在进入最终报告阶段前已经把最终有效的 `risks / test_cases / business_flows` 聚合进 final state，`report.md` / `report.html` 也是由这份 state 渲染，因此这是终态和已生成报告 Run 的权威结构化数据源。
2. **尚未形成 final state 的运行中 Run**，按 `progress.json` 的完成单元读取 `agent-results/analysis` / `agent-results/rework`，返工结果覆盖原 analysis 结果。
3. **已生成报告但缺少可用 final-state 的旧 Run**，允许兼容回退读取 worker result，但会标记为 `warning`，不会伪装成标准路径。

## v0.4.0 Reader 一致性层

报告现在只承担“交叉核对”职责，不会被解析成新的风险/用例对象。

对于当前 Run，Reader 会先尝试从 `report.md` 提取报告摘要；Markdown 存在但格式无法识别时，会继续尝试 `report.html`。对账字段包括：

- 业务流程数量；
- 风险数量；
- 测试用例数量。

然后与当前结构化数据源的计数对账，并返回：

```text
reader_health.status      ok / warning / error
reader_health.trusted     true / false
reader_health.count_checks
reader_health.issues
```

典型状态：

```text
正常
数据源：final-state
风险 17 = 报告 17
测试用例 31 = 报告 31
```

如果出现：

```text
报告：17 个风险
结构化读取：0 个风险
```

则直接返回：

```text
status = error
trusted = false
```

Better Sidebar 会显示“数据读取异常”，`pangea_status` 也会明确说明当前结构化结果不可信。此时 **0 不允许被解释为“没有风险/用例”**。

如果报告存在但无法自动提取计数、终态 Run 缺少报告、final-state 读取失败，或报告 Run 只能退回 worker result，则返回 `warning` 和具体诊断原因。

历史 Run 列表不会读取 Worker 结果、构建风险/用例/证据关联，也不会逐个解析整份报告；只有当前选中的 Run 才执行完整读取和报告对账，避免历史任务很多时拖慢侧栏。

## Better Sidebar Explorer

PANGEA Tab 提供中文结果浏览器：

- 固定顶部导航：`总览 / 风险 / 用例 / 证据 / 复核`，任何页面都能直接跳转。
- 详情页固定提供 `← 返回`，使用页面栈按真实访问路径退回；例如 `风险 → 用例 → 风险` 可以逐级返回，不会钻进死胡同。
- 总览顶部显示 Reader 数据状态、数据源和报告对账结果。
- Reader 判定 `trusted=false` 时，详情页也持续显示告警；风险/用例空列表会明确提示“当前列表不可信”，不会显示普通的“没有数据”。
- 总览里的风险、用例、证据、复核问题卡片可直接进入对应列表。
- 风险列表支持关键词搜索和严重度筛选；风险详情展示触发条件、系统结果、外部观察、排除条件、上游语义核对、证据和关联用例。
- 测试用例列表支持搜索；详情展示前置条件、执行步骤、预期结果、观察点、清理动作，并可跳回关联风险。
- 证据列表支持搜索；详情展示源码/资料位置、观察结论和关联风险。
- 复核页展示 Reviewer、复核结论和每条 review issue 的原因/要求修改。
- 风险、用例和证据详情页可把当前对象及其直接关联内容加入 DSH 会话输入框，支持综合判断、证据检查、改写测试语言和查找覆盖缺口。
- 风险详情在同一张源码卡片中提供多证据选择器，默认预览首条可读取证据；切换时不离开当前风险。证据详情预览当前证据，源码片段显示真实行号，并轻量标出 PANGEA 指向的行范围。
- “连同源码加入会话”会把当前对象、关联项和可见源码片段一起写入 DSH 草稿，不会自动发送。
- 证据详情可在 Better Sidebar 中打开完整文件；总览可直接打开 `report.html` 或 `report.md`。Better Sidebar 当前公开接口不支持指定光标行号，因此 Companion 在自己的预览卡片中完成准确行号定位，不伪装成编辑器已跳转。
- 切换历史 Run 时自动回到该 Run 的总览，避免保留上一个 Run 的详情导航状态。
- 当前 Run 使用顺序轮询：上一轮读取结束后才安排下一轮，不会堆叠请求；切换 Run 或工作区会取消旧请求，避免旧结果覆盖新页面。
- 首次加载、后台同步失败和无工作区分别显示明确状态；短暂同步失败时保留上一次可信结果。
- 界面直接使用 DSH 官方语义颜色变量，跟随浅色、深色与宿主主题，不注入独立皮肤。

## 边界

依赖方向固定为：

```text
pangea-agent  <- read only -  dsh-pangea-companion  -> optional -> dsh-better-sidebar
```

禁止 Companion：

- 调用 PANGEA CLI 推进 Run。
- 修改 `progress.json`、`final-state.json`、task/result 文件。
- 替 PANGEA 实现 analysis/review/rework 状态机。
- 把 DSH 或 Companion 依赖反向引入 `pangea-agent`。

因此卸载 DSH 或 Companion 后，PANGEA 仍可由 OpenCode、Claude Code 或其他兼容 Agent Runtime 按原流程完整运行。

## 在 DSH 中讨论 PANGEA 对象

在 PANGEA Tab 中打开一条风险、测试用例或证据，点击“加入当前会话”。Companion 会把当前对象、直接证据和关联项写入当前 DSH 输入框，但不会自动发送。你可以检查内容、继续补充问题，然后由 DSH 回答。

风险或证据存在可读取的本地源码时，页面还会出现“源码片段”卡片。一条风险有多条证据时，可在卡片顶部原地切换文件和行号；点击“检查这段源码”，DSH 草稿只包含待核对结论和当前选中的带行号源码，不会混入同一风险的其他证据。普通“加入当前会话”仍会加入当前对象、直接证据和关联项。

这个动作只修改当前会话的草稿，不写入 PANGEA 目录，也不改变 Run 状态。

## 安装

克隆仓库并进入项目目录：

```bash
git clone https://github.com/CyberShp/dsh-pangea.git
cd dsh-pangea
```

如果还装着旧版 bridge，先卸载：

```bash
npx @deepseek-ai/dsh plugin --profile web remove dsh-pangea-bridge
```

需要 PANGEA 侧栏页面时，先安装 Better Sidebar：

```bash
npx @deepseek-ai/dsh plugin --profile web add dsh-better-sidebar@latest
```

然后从仓库根目录安装 Companion：

```bash
npx @deepseek-ai/dsh plugin --profile web add "$PWD/plugins/dsh-pangea-companion"
```

如果已经安装 `dsh-better-sidebar`，硬刷新 DSH Web 后会在它的 `+` 菜单中看到 `PANGEA` 页面。没有安装 better-sidebar 时不影响 `pangea_status`。

推荐把 DSH workspace 直接设置为 `pangea-agent` 根目录，这样 Companion 能自动发现：

```text
pangea-agent/
└── pangea-data/
    └── runs/
```

## 开发与验证

```bash
cd plugins/dsh-pangea-companion
npm test
```

当前测试覆盖：运行中 worker result、返工替换、final-state 正常终态、Markdown → HTML 报告回退、报告/结构化计数不一致 fail-loud、旧 Run worker-result 兼容回退、历史 Run 摘要模式、中文工具输出、客户端请求编码/错误处理、局部讨论上下文、会话草稿插入、证据路径与行范围解析、源码片段读取、多证据选择标签、Better Sidebar 单实例注册和健康状态交互入口。
