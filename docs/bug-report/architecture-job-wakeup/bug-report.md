# 外部画图完成误唤醒内置 API 父会话

发现时间：2026-09-09（UTC+8）；报告人：Codex，Windows 真实 OpenCode 联调。

## 复现与根因

在无内置 API 模型的独立 Dev profile，通过 `pangea-opencode` 和明确的 MiniMax 模型创建图任务。
外部 Agent 已生成通过 Archify 的流程图，但 `tool-jobs` 在后台任务完成时调用父会话 `followup`。
父会话只承载外部任务，未配置内置 API，因而产生 `has no provider/model` 错误回合。

真实实例：Desktop `093b63b` 与 SVG 修复、端口 `127.0.0.1:9394`、父会话
`session-bbb49da6-41c1-401e-a544-779061a6e462`，图任务 `subagent-2`。
调查限定该图的 session、Job、渲染收据与已安装 DSH 源码，不更改用户 profile。

## 修复

架构视图在放行 ACP 启动前注册 Jobs 的完成等待，声明由产品接收此任务结果。
Jobs 自身在终态将结果标记为 reported，仍通知观察者并保留输出；通用 tool-jobs 不再另起内置模型回合。
等待使用 Jobs API 所要求的有限超时（Node 最大定时器值），实际完成或取消即释放，不轮询、不限制图任务时长，也不改变全局通知配置。

## 验证

新增真实 Cordis + LocalJobRegistry + tool-jobs 的集成用例：修复前父会话被唤醒一次，修复后零次；完成观察者收到 completed，输出仍可读取。
与原有分析任务绑定/settlement 集成及模型继承、图产物边界测试共同通过。
另有真实宿主取消证据，图任务停止时主分析 Job 仍 running。

诊断策略为先复现错误回合，再跟踪默认完成通知；不配置替代模型掩盖错误。验收以零额外父模型回合、完成事件和产物可读为准。
