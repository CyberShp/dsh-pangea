# Plugins

每个 DSH 插件放在本目录下的独立子目录中。

## 当前插件

- `dsh-pangea-companion/`：PANGEA 伴生工作台；提供只读 Run 状态、执行环境与 Executor 会话、可信结果导航、证据/报告浏览，并内置仅对 PANGEA 工作区生效的 `subagent-report` 静默投递策略。
- `dsh-pangea-asset-catalog/`：只读分析 `inbox` 与 `test-automation` 文件，生成非约束性的资料、方法论候选和自动化能力目录，不修改或影响 PANGEA 决策。
