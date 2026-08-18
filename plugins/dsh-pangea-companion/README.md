# dsh-pangea-companion

`dsh-pangea-companion` 是 PANGEA 在 DeepSeek Harness 中的只读伴生工作台。

它不创建 Contract、不推进 PANGEA phase、不派发 analysis/review/rework worker，也不改写 `progress.json`、`agent-tasks/`、`agent-results/` 或报告。PANGEA 仍是唯一工作流真相；Companion 只读取 Run 状态和结构化产物，让 DSH 更容易观察、查询和浏览分析过程。

## 当前能力

- 自动从当前 DSH workspace 向上发现 `pangea-data/runs/`。
- `pangea_status`：读取当前或指定 Run 的 phase、quality、analysis 进度、风险/用例/证据数量和当前错误。
- 自动选择最新的非终态 Run；没有活动 Run 时回退到最新 Run。
- 返工结果按 `unit_id` 覆盖原 analysis 结果计数，避免重复统计。
- 只读同源接口 `GET /api/pangea-companion/state`，供 Web UI 使用。
- 检测到 `dsh-better-sidebar` 时，注册单实例 `PANGEA` Tab，显示当前 Run、进度、质量、风险/用例/证据统计和最近 Run。
- `dsh-better-sidebar` 是可选 peer dependency；未安装时 Host 工具与只读 Core 仍可工作。

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

先卸载旧插件：

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

也可以在调用 `pangea_status` 时显式传入绝对 `data_root`。

## `pangea_status`

典型问题：

```text
现在 PANGEA 跑到哪了？
当前 Run 有多少风险和测试用例？
看一下 run-xxx 的状态。
```

工具只读，不会因为查询状态而恢复或推进 Run。

## Better Sidebar Cockpit

当前第一版 Cockpit 提供：

- Current Run / Phase / Quality / Review。
- Analysis 完成进度。
- Risks / Test Cases / Evidence / Review Issues 计数。
- 当前错误。
- Recent Runs 切换和自动刷新。

下一阶段再增加 Risk / Evidence / Test Case / Review Issue Explorer 和 Run Diff；这些能力仍保持只读 PANGEA 原始产物。

## 开发与验证

```bash
cd plugins/dsh-pangea-companion
npm test
```

当前单元测试不要求真实 PANGEA 或 DSH 进程，使用临时 `pangea-data` 验证发现、Run 汇总、返工去重和插件注册边界。
