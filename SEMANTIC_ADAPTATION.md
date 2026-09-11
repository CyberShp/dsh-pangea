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

Companion：211 项检查，210 通过、1 跳过；资产插件：21 项，20 通过、1 跳过；
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
