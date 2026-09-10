# Semantic 分支接入

本分支从 `codetalks-skill@48b7921` 创建，对接 pangea-agent
`codex/pangea-semantic-analysis-rework@58398f10ef7663b23c24310f932a76d77254d0d2`。

工作台通过 companion 创建 source-first Run，展示任务进度、冻结源码信息、
Agent 原文记录与报告。DSH 根 Agent 通过 report-policy 创建并绑定子任务，
按明确的 action_id 结算；Comparison 与定向修正续接原会话。
OpenCode ACP 使用 `.opencode/agents/pangea-agent.md` 和自己的 dispatch 工具。

工具接入包含 task-open、input-read、整文件规划、分页源码读取、结果读写和修复、
comparison 读取、review 决定及 work-finish。任务保存保留显式上下文预算；
已有任务的 Run 绑定不会被其他会话快照覆盖。流程完成和质量状态分别展示。
ACP 结束时复用 source-first reader 确认当前 Run 的报告；宿主 Job 以编号和
启动时间共同绑定，输出、结算和停止操作均核对同一次执行。

配套 Desktop 分支为 `codex/pangea-semantic-adaptation`，其
`pangea.components.json` 固定本仓库提交和上述 Agent 提交。

## 验证

在 `plugins/dsh-pangea-companion` 运行 `npm test` 验证插件。
真实 CLI 集成检查另需设置 `PANGEA_INTEGRATION_RUNTIME` 为 Agent 目录，
`PANGEA_PYTHON` 为已安装 Agent 依赖的 Python，然后运行：

```text
node --test tests/semantic-runtime.test.mjs
```

该检查使用临时样例源码，验证创建、绑定、整文件规划、阶段推进、恢复同一 Run、
上下文预算保存、工作台读取和停止。它不调用模型，不代表分析质量验收。

真正的客户端验收需要从配套 Desktop 页面创建任务，记录实际 provider、model、
Run ID、任务会话和报告；模型不可用或报告质量未通过时应分别报告。
