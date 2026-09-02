# dsh-pangea-companion

`dsh-pangea-companion` 是 PANGEA 在 DeepSeek Harness 中的伴生插件：创建 Run 后立即通过 DSH 的内置模型或已注册 ACP Agent 启动 Codetalks Skill，监听冻结 Run 的 Markdown 产物和生命周期，并保留独立的用例执行能力。

分析插件不自行生成阶段、结果或报告：它只负责创建唯一 Skill Run、启动已选择的执行 Agent、读取真实状态并展示诊断。用例执行仍使用 `pangea-data/executor-runs/` 中的独立 Executor Run，和分析生命周期分开。

## 当前能力

- 自动从当前 DSH workspace 向上发现 `pangea-data/runs/`。
- `pangea_status`：读取当前或指定 Run 的阶段、质量状态、分析进度、风险/用例/证据数量和读取健康状态，模型侧输出中文。
- 自动选择最新的非终态 Run；没有活动 Run 时回退到最新 Run。用户点选历史 Run 时按明确 `run_id` 读取，不会回退到当前最新任务。
- 将当前 DSH 会话与 PANGEA Run 做最小只读关联，只记录 Run、工作区、关联会话和 PANGEA 阶段/分析进度；DSH 自己负责展示 Agent、工具、子 Agent 和工作流轨迹。
- 会话删除后仍按 Run 保留最小关联摘要；历史 Run 不依赖原 DSH 会话继续存在。
- 当前 Run 返回结构化明细：风险、测试用例、证据、业务流程、复核问题；历史 Run 保持轻量摘要。
- 通过稳定 `system / runs` API 检查后端兼容性、分页列出全部 Run，并支持新建和显式确认停止；停止时即使 ACP 或 PANGEA API 一侧不可用，也会保留错误并继续尝试其余取消动作。
- 新建分析会先创建冻结的 Codetalks Skill Run，随后使用用户选定的内置 API、NGA、CodeAgent、OpenCode 或 Claude Code 执行 Step 01–09；页面只监听 Skill 状态和 Markdown 产物。
- 新建分析只接受仓库、目标、源码范围、资产库勾选和执行方式；分析重点由 Skill 固定，不接受手写 focus、结构化资产 ID 或示例文件路径。
- 建立 `风险 ↔ 测试用例 ↔ 证据` 关联，便于从风险追到测试和源码证据，再按访问路径返回。
- 只读同源接口 `GET /api/pangea-companion/state`，供 Web UI 使用。
- 通过 `ctx.pangea` 向统一工作台注册“分析”和“执行”两页，不再直接注册 Better Sidebar Tab。
- `dsh-pangea` 是客户端页面的必需 peer dependency；通用侧栏只由基座接入。
- 当前 Agent 工作目录或其上级目录存在 `.agents/pangea/dsh.md` 时，`subagent-report` 静默投递，由原生 `subagent-settled` 在子 Agent 真正结束后唤醒根 Agent；其他工作区保持 DSH 默认行为。
- 内置 API Agent 和 ACP Agent 的启动失败都会写入持久化 launch log，并在任务总览中显示失败阶段、错误码和原始错误；不会用伪造结果或静默回退掩盖失败。
- 在“执行”页维护主机 alias、阵列 alias、自动化仓库 ID 和设备绑定；SSH 用户名/密码继续使用 `dsh-ssh` 的 `~/.dsh/dsh-ssh.json`。
- 在用例列表中多选测试用例和执行环境，一键创建真实 DSH 执行会话；执行会话按独立 Executor Graph 生成计划并运行。
- 提供 `pangea_environment_get`、`pangea_ssh_exec/start/read/stop/interactive` 工具，支持普通命令、持续 IO 后台任务和同一阵列 PTY 内的 `diagnose_usr → attach → dtoe` 交互。
- 在当前分析 Run 下展示对应的 Executor Run、计划、结果和 `UNRESOLVED` 原因。

## 数据读取规则

Companion 只读取冻结 Codetalks Skill Run 的 Markdown 和内部索引：

1. `内部索引/运行状态.json` 是唯一生命周期真相；状态为 `running` 时，当前步骤严格来自 `current_step`。
2. `活文档/` 是运行中产物，按冻结 `workflow-manifest.json` 的步骤归属展示；例如 Step 03 本身允许生成 `03–07` 号广度盘点文档，不代表 Step 04–07 已完成。
3. `正式输出/` 只在 Step 09/finalize 成功后作为交付展示；缺失或不完整时标记为未完成，不从文件名猜测成功。
4. 旧版 Run 从自己的冻结 manifest 读取版本；当前 2.0 请求与 `codetalks-skill 1.2.0` Run 额外展示资产和方法论冻结信息。

Reader 不创建风险、用例、复核结论或报告，也不读取旧 `progress.json`、`final-state.json`、`agent-results/` 作为分析结果来源。

## Reader 与生命周期

Reader 对每个 Run 只做确定性文件读取，不从自然语言或文件名推断阶段：

- `内部索引/运行状态.json` 的 `status`、`current_step` 和 `completed_steps` 映射为页面生命周期；`validation_failed` 显示为“未完整结束”。
- `workflow-manifest.json` 决定 Markdown 产物属于哪个步骤。Step 03 的广度盘点可以一次产生 `03–07` 号文档，只有 `complete-step 03` 成功后才会进入 Step 04。
- 运行中只读 `活文档/` 和内部索引；Step 09/finalize 成功后才展示 `正式输出/` 报告。
- 文件缺失、状态损坏或旧 Run 不含新字段时返回明确的 `reader_warnings`；不会用空列表冒充“没有风险/用例”。
- 历史 Run 列表只读取轻量摘要；用户明确选择 `run_id` 时直接读取该 Run，即使它不在当前分页首屏，也不会跳到最新 Run。

## PANGEA 侧边栏页面

Companion 在 Better Sidebar 中注册“分析”和“执行”两个顶层页签：

- “分析”页内部固定导航：`总览 / 流程 / 风险 / 用例 / 业务流 / 证据 / 复核`，任何页面都能直接跳转；总览是默认入口。
- “执行”页用于维护执行环境和查看独立 Executor Run。
- 总览显示后端兼容性、完整 Run 分页、当前 Run 进度和停止入口；“新建分析”表单接受仓库、目标、源码范围、资产库勾选、内置模型或 ACP Agent。
- “流程”页显示冻结 Skill 的 Step 01–09 生命周期、Markdown 产物、核心规则 ACK、独立 Judge 和未解决事项；不显示已删除的 analysis action/bind/validate/settle 状态机。
- “业务流”页展示结构化步骤、证据和 Mermaid 文本，支持搜索。
- Companion 不重复展示 DSH 已有的 Agent / Tool / Subagent / Workflow 轨迹；总览只聚焦 PANGEA 阶段、进度、质量、风险、用例、证据和复核。
- 即使原 DSH 会话已删除，历史 Run 的风险、用例、证据、复核和报告仍可查看；Companion 不保存 DSH 执行时间线。
- 详情页固定提供 `← 返回`，使用页面栈按真实访问路径退回；例如 `风险 → 用例 → 风险` 可以逐级返回，不会钻进死胡同。
- 总览顶部显示 Reader 数据状态、数据源和报告对账结果。
- Reader 判定 `trusted=false` 时，详情页也持续显示告警；风险/用例空列表会明确提示“当前列表不可信”，不会显示普通的“没有数据”。
- 总览里的风险、用例、证据、复核问题卡片可直接进入对应列表。
- 风险列表支持关键词搜索和严重度筛选；风险详情展示触发条件、系统结果、外部观察、排除条件、上游语义核对、证据和关联用例。
- 测试用例列表支持搜索；详情展示前置条件、执行步骤、预期结果、观察点、清理动作，并可跳回关联风险。
- 证据列表支持搜索；详情展示源码/资料位置、观察结论和关联风险。
- 复核页分别展示独立发现、对照复核的确认/驳回结论，以及最终仍有效的问题。
- 风险、用例和证据详情页可把当前对象及其直接关联内容加入 DSH 会话输入框，支持综合判断、证据检查、改写测试语言和查找覆盖缺口。
- 风险详情会把“系统结果”拆成可选结论；可以勾选任意数量的源码证据，只核对当前结论与选中证据，或把这组局部上下文转成定向测试。
- 风险详情在同一张源码卡片中提供多证据选择器，默认预览首条可读取证据；切换时不离开当前风险。证据详情预览当前证据，源码片段显示真实行号，并轻量标出 PANGEA 指向的行范围。
- “连同源码加入会话”会把当前对象、关联项和可见源码片段一起写入 DSH 草稿，不会自动发送。
- 证据详情可经 `ctx.pangea.openFile()` 在 Better Sidebar 中打开完整文件；总览可直接打开 `report.html` 或 `report.md`。当前文件接口不支持指定光标行号，因此 Companion 在自己的预览卡片中完成准确行号定位，不伪装成编辑器已跳转。
- 切换历史 Run 时自动回到该 Run 的总览，避免保留上一个 Run 的详情导航状态。
- 当前 Run 使用顺序轮询：上一轮读取结束后才安排下一轮，不会堆叠请求；切换 Run 或工作区会取消旧请求，避免旧结果覆盖新页面。
- 首次加载、后台同步失败和无工作区分别显示明确状态；短暂同步失败时保留上一次可信结果。
- 界面直接使用 DSH 官方语义颜色变量，跟随浅色、深色与宿主主题，不注入独立皮肤。

## Run 关联摘要保存范围

Companion 的最小运行摘要保存在 DSH 用户目录：

```text
$DSH_HOME/dsh-pangea-companion/monitor-v1.json
```

未设置 `DSH_HOME` 时使用 `~/.dsh/dsh-pangea-companion/monitor-v1.json`。

只保存：

- Run ID、关联过的 DSH 会话 ID、工作区和活动时间；
- PANGEA 阶段与分析进度摘要。

不会保存 Agent 运行/空闲变化、工具调用、子 Agent 或工作流成员轨迹；这些信息由 DSH 原生轨迹负责。

不保存提示词、工具参数、工具结果全文、源码或证据内容，也不写入 `pangea-data`。因此删除 DSH 会话不会删除 PANGEA Run；只能失去 DSH 自己未被摘要记录的完整会话内容。

## 边界

依赖方向固定为：

```text
pangea-agent direct Skill API    <- Run creation and state reads - dsh-pangea-companion
pangea-agent executor Graph      <- DSH execution session follows actions (only for test execution)
dsh-ssh host configuration       <- aliases/passwords - Companion SSH tools
```

禁止 Companion：

- 直接修改 Skill Run 的状态、Markdown、语义结果或正式报告。
- 在 DSH 内另建一套 planning / analysis / review / closure 状态机。
- 把 DSH 或 Companion 依赖反向引入 `pangea-agent`。

因此卸载 DSH 或 Companion 后，冻结的 Skill Run 仍可由 pangea-agent 读取；用例执行的 Executor Graph 仍是独立边界。

## 用例执行准备

1. 使用 dsh-ssh 配置主机和阵列 alias，可使用密码登录。
2. 将内部 Python 自动化仓库放到 `pangea-data/test-automation/<automation_id>/`。
3. 在 Companion“执行”页创建或选择执行环境。
4. 回到“用例”页勾选用例和环境，点击“一键执行”。

Companion 的交互 SSH 当前支持直接连接；若 dsh-ssh alias 配置了 ProxyJump，执行前会明确报 `UNRESOLVED/EXECUTION_FAILED`，不会改用另一条连接路径。

## 在 DSH 中讨论 PANGEA 对象

在“分析”页签中打开一条风险、测试用例或证据，点击“加入当前会话”。Companion 会把当前对象、直接证据和关联项写入当前 DSH 输入框，但不会自动发送。你可以检查内容、继续补充问题，然后由 DSH 回答。

风险或证据存在可读取的本地源码时，页面还会出现“源码片段”卡片。一条风险有多条证据时，可在卡片顶部原地切换文件和行号。

风险详情中的“定向核对与测试”提供两层选择：

1. 从“系统结果”拆出的结论中选择一条；
2. 勾选一条或多条源码证据。

“核对选中证据”只把这条结论和已选源码加入草稿；“转成定向测试”还会加入风险的触发条件与外部观察，用来生成前置条件、操作步骤、观察点和预期结果。两种动作都不会混入未选择的证据。普通“加入当前会话”仍会加入当前对象、全部直接证据和关联项。

在独立证据详情中，仍可点击“检查这段源码”，只核对该证据的观察结论与当前源码。

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

只安装 PANGEA 基座。它会自动安装固定版本的 Better Sidebar、Companion 和 Asset
Catalog；本地路径要使用 `file:` 前缀：

```bash
npx @deepseek-ai/dsh plugin --profile web add "file:$PWD/plugins/dsh-pangea"
```

硬刷新 DSH Web 后，Better Sidebar 的 `+` 菜单会直接显示“分析”和“执行”；不再有
外层 `PANGEA` 包装入口。

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

当前测试覆盖：分析结果读取、报告/结构化计数核对、独立与对照复核合并、历史 Run 摘要、Run 分页/新建/停止、资产草稿传递、会话关联、环境保存、真实 DSH 执行会话启动、Executor Run 展示、SSH 工具注册和证据交互。
