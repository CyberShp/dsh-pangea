# Langgraph 配套工作台

`langgraph` 已合入 `origin/codetalks-skill@1f819d3`（2026-09-10），
对接 `pangea-agent langgraph@a92877f810ec93e8b5f79ffe16c86b1a0fba5e85`。
Desktop 配套版本以其 `pangea.components.json` 为准。

## 产品行为

沿用最新工作台、PANGEA 分析、测试资产导航。分析页提供概览、业务流程、风险、
测试用例、运行过程、复核六个入口，以及流程阅读、关联跳转、搜索、冻结源码
预览、讨论草稿和 CSV/XLSX 导出。

Companion 按运行时能力选择 codetalks-skill 或 source-first 协议。source-first
通过 action_id 绑定和结算任务，Comparison 与定向修正续接原会话。Graph 负责
独立 Reviewer；宿主单独记录 ACP 执行状态，按 Job 编号、所有者及启动时间
核对执行身份。任务上下文预算持久保存。

风险、用例、流程按明确 record kind 和字段投影，保留原始正文与业务编号。
关联在分析单元内解析，已接受的 closure 替代对应单元分析结果，读取时核对
Run/action/task 绑定与 revision。源码预览读取当前 Run 冻结文件。
流程展示节点和路径；用例导出同时包含分析单元、原始记录编号与正文。

资产页支持 semantic 引擎的列表、筛选、新建导入、解析、审核和归档。
导入预览由宿主计算文件摘要并在提交前复核。当前引擎尚未提供资产恢复、
元数据编辑、新修订和逐条审核，界面按能力控制这些操作。

## 验证

Companion：219 项检查，218 通过、1 跳过；资产插件：22 项，21 通过、1 跳过；
产品导航：25 项通过。Companion 包含真实 Python CLI 创建、绑定、规划、结算、
恢复同一 Run、预算保存和停止检查。执行命令：

```sh
PANGEA_INTEGRATION_RUNTIME=/Volumes/Media/pangea-agent \
PANGEA_PYTHON=/Volumes/Media/pangea-agent/.venv/bin/python npm test
```

2026-09-10 独立 Desktop profile 实跑 `sample-c-260910-01`，路径为
Desktop → DSH → OpenCode ACP → MiniMax M2.7，上下文预算 204800。
Run 达到 complete/PASS，宿主 execution_status 为 completed，HTML/Markdown
报告可读，CSV/XLSX 导出保留业务编号和分析原文。资产列表和文件预览导入实测成功。
该样例为单个加法函数，证明组件接入与状态结算；大型仓库质量、Windows 运行和
DSH 内置 API 模型实跑尚未验收。

## 源码交接与局部修订

Agent `a92877f` 配套支持 `task-open --prepare-source`；DSH 在分析、盲审和返修
启动指引中要求准备冻结源码，保留 pending_reads 的补读要求。`pangea_source_read`
默认返回 text 分页，支持原样传入 next_read；使用旧 cursor 时保留 legacy 方式。
新增 `pangea_result_supersede` 传递完整 replacement 或局部 edits，均交给 Agent
现有实现核对绑定、revision 与精确文本。局部修订保留历史与证据，重复 request_id
复用回执，匹配失败不写入。

真实 CLI 集成检查覆盖源码准备、101 行源码分页、文本修订与历史、重试、失败不写入、
盲审源码准备及同一 Reviewer 的 Comparison 结算，最终达到 complete。

## 风险详情与运行契约（2026-09-13）

风险详情读取 `description`、`impact`、`expectation` / `correct_expectation`、`current_behavior`，并保留原有 `narrative`、
`behavior`、`user_impact` 等字段。原始 JSON 对象与 Markdown 正文直接展开；
记录未提供的结构化字段不再形成一排空卡片。`record_id` 关联和带 unit 的记录关联
均可跳转；独立证据记录通过显式关联进入风险详情，同名风险仍按分析单元隔离。
界面暂时隐藏复核页签和入口，Graph 审查流程及已存产物保持可读取。

`system capabilities` 通过 `source_first.analysis_options` 声明模块分析 / 深度型，
通过 `asset_operations` 分别声明资产操作。界面禁用不支持的选项，创建接口同时检查；
Coverage 材料通过分析资产传入。旧引擎保留已知接口兼容行为。

新引擎通过 `source_first.contract_fields` 声明可冻结 `analysis_settings` 和
`runtime_provenance`。DSH 记录进程加载时的插件版本与文件指纹、工作区规则指纹，
Desktop 提供启动时的应用版本与入口指纹，Agent 创建 Run 时加入自身版本、源码及
规则指纹。恢复 Run 保持原记录；历史 Run 未记录的组件显示未记录。Git 提交缺失时
保留版本和文件指纹，不把组件锁定清单当成已加载提交。

同时创建的 Run 各用独立请求文件，结束后只清理本次文件。自动验证覆盖两任务并发、
冻结设置、恢复时身份不变、对象/Markdown 风险内容、同编号隔离和风险到用例跳转。


实际 Desktop → DSH → OpenCode → MiniMax M2.7 小样例 `sample-c-260913-01`
达到 complete/PASS，产出 1 条风险、3 条用例、1 条流程；浏览器确认风险说明、影响、
原文、源码证据和关联用例可见。实跑发现的 `completion: null` 空壳与
`correct_expectation` / `case_ids` 字段变体已加入回归样本。空壳只在运行中的待绑定
comparison action、revision 0、无记录且未接受时显示准备状态；任务、Run 或 action
身份冲突和已提交内容仍然报警。
