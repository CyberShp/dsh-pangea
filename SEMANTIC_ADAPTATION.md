# Semantic 分支接入

本分支从 `codetalks-skill@48b7921` 创建，对接 pangea-agent
`langgraph@58398f10ef7663b23c24310f932a76d77254d0d2`。

工作台通过 companion 创建 source-first Run，沿用概览、风险、测试用例、分析资产
页面，以及搜索、分组、关联跳转、源码预览和讨论草稿操作。运行流程保留阶段、
任务版本和原文记录，报告入口提供完整交付。DSH 根 Agent 通过 report-policy 创建并绑定子任务，
按明确的 action_id 结算；Comparison 与定向修正续接原会话。
OpenCode ACP 使用 `.opencode/agents/pangea-agent.md` 和自己的 dispatch 工具。

工具接入包含 task-open、input-read、整文件规划、分页源码读取、结果读写和修复、
comparison 读取、review 决定及 work-finish。任务保存保留显式上下文预算；
已有任务的 Run 绑定不会被其他会话快照覆盖。流程完成和质量状态分别展示。
ACP 结束时复用 source-first reader 确认当前 Run 的报告；宿主 Job 以编号和
启动时间共同绑定，输出、结算和停止操作均核对同一次执行。

配套 Desktop 分支为 `langgraph`，其
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

## 工作台记录映射

页面按 Agent 明确的 record kind 与字段展示风险、用例和流程，保留原始正文与
结果文件位置。每条记录使用分析单元与 record_id 定位；原始业务编号用于显示和
搜索。关联仅依据明确编号，在当前分析单元内解析；相同编号不会跨单元串联。
已接受的定向修正替代对应单元的分析记录，supersedes 记录保留在运行流程供追溯。
读取层核对结果的 Run、action、task 绑定及已接受 revision。

源码引用按当前 Run 的冻结仓库目录预览。Markdown 正文保留原文，用例组仍作为
一条组记录展示。统计代表可读取的有效记录数量，不代表语义质量或实际执行结果。
当前 Agent 版本没有旧 Executor 接口，source-first 页面的执行按钮显示不可用；
用例查看、计划选择和讨论草稿正常开放。
