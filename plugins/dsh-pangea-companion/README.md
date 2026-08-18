# dsh-pangea-companion

`dsh-pangea-companion` 是 PANGEA 在 DeepSeek Harness 中的只读伴生工作台。

它不创建 Contract、不推进 PANGEA phase、不派发 analysis/review/rework worker，也不改写 `progress.json`、`agent-tasks/`、`agent-results/` 或报告。PANGEA 仍是唯一工作流真相；Companion 只读取 Run 状态和结构化产物，让 DSH 更容易观察、查询和浏览分析过程。

## 当前能力

- 自动从当前 DSH workspace 向上发现 `pangea-data/runs/`。
- `pangea_status`：读取当前或指定 Run 的阶段、质量状态、分析进度、风险/用例/证据数量和当前错误，模型侧输出中文。
- 自动选择最新的非终态 Run；没有活动 Run 时回退到最新 Run。
- 返工结果按 `unit_id` 覆盖原 analysis 结果，避免把旧结果和返工结果重复展示。
- 当前 Run 返回结构化明细：风险、测试用例、证据、业务流程、复核问题；历史 Run 保持轻量摘要。
- 建立 `风险 ↔ 测试用例 ↔ 证据` 关联，便于从风险追到测试和源码证据，再按访问路径返回。
- 只读同源接口 `GET /api/pangea-companion/state`，供 Web UI 使用。
- 检测到 `dsh-better-sidebar` 时，注册单实例 `PANGEA` Tab。
- `dsh-better-sidebar` 是可选 peer dependency；未安装时 Host 工具与只读 Core 仍可工作。

## Better Sidebar Explorer

v0.3.0 起不再只是 Run 摘要，PANGEA Tab 提供中文结果浏览器：

- 固定顶部导航：`总览 / 风险 / 用例 / 证据 / 复核`，任何页面都能直接跳转。
- 详情页固定提供 `← 返回`，使用页面栈按真实访问路径退回；例如 `风险 → 用例 → 风险` 可以逐级返回，不会钻进死胡同。
- 总览里的风险、用例、证据、复核问题卡片可直接进入对应列表。
- 风险列表支持关键词搜索和严重度筛选；风险详情展示触发条件、系统结果、外部观察、排除条件、上游语义核对、证据和关联用例。
- 测试用例列表支持搜索；详情展示前置条件、执行步骤、预期结果、观察点、清理动作，并可跳回关联风险。
- 证据列表支持搜索；详情展示源码/资料位置、观察结论和关联风险。
- 复核页展示 Reviewer、复核结论和每条 review issue 的原因/要求修改。
- 切换历史 Run 时自动回到该 Run 的总览，避免保留上一个 Run 的详情导航状态。

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

## 安装

如果还装着旧版 bridge，先卸载：

```bash
npx @deepseek-ai/dsh plugin --profile web remove dsh-pangea-bridge
```

从本仓库本地目录安装 Companion：

```bash
npx @deepseek-ai/dsh plugin --profile web add /absolute/path/to/dsh-pangea/plugins/dsh-pangea-companion
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

当前测试覆盖：data-root 发现、返工结果替换、结构化明细与交叉关联、历史 Run 轻量化、中文工具输出、Better Sidebar 单实例注册和中文导航/返回入口。
