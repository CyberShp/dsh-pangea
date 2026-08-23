# dsh-pangea-companion

`dsh-pangea-companion` 是 PANGEA 在 DeepSeek Harness 中的伴生插件：查看分析结果、维护执行环境、启动独立的用例执行任务，并内置 PANGEA 工作区的子 Agent 唤醒策略。

它不推进或改写原来的 analysis/review/rework Graph。用例执行使用 `pangea-data/executor-runs/` 中的独立 Executor Run；原 `progress.json`、`final-state.json` 和报告保持不变。

## 当前能力

- 自动从当前 DSH workspace 向上发现 `pangea-data/runs/`。
- `pangea_status`：读取当前或指定 Run 的阶段、质量状态、分析进度、风险/用例/证据数量和读取健康状态，模型侧输出中文。
- 自动选择最新的非终态 Run；没有活动 Run 时回退到最新 Run。
- 将当前 DSH 会话与 PANGEA Run 做最小只读关联，只记录 Run、工作区、关联会话和 PANGEA 阶段/分析进度；DSH 自己负责展示 Agent、工具、子 Agent 和工作流轨迹。
- 会话删除后仍按 Run 保留最小关联摘要；历史 Run 不依赖原 DSH 会话继续存在。
- 当前 Run 返回结构化明细：风险、测试用例、证据、业务流程、复核问题；历史 Run 保持轻量摘要。
- 建立 `风险 ↔ 测试用例 ↔ 证据` 关联，便于从风险追到测试和源码证据，再按访问路径返回。
- 只读同源接口 `GET /api/pangea-companion/state`，供 Web UI 使用。
- 检测到 `dsh-better-sidebar` 时，注册单实例 `PANGEA` Tab。
- `dsh-better-sidebar` 是可选 peer dependency；未安装时 Host 工具与只读 Core 仍可工作。
- 当前 Agent 工作目录或其上级目录存在 `.agents/pangea/dsh.md` 时，`subagent-report` 静默投递，由原生 `subagent-settled` 在子 Agent 真正结束后唤醒根 Agent；其他工作区保持 DSH 默认行为。
- 在“执行”页维护主机 alias、阵列 alias、自动化仓库 ID 和设备绑定；SSH 用户名/密码继续使用 `dsh-ssh` 的 `~/.dsh/dsh-ssh.json`。
- 在用例列表中多选测试用例和执行环境，一键创建真实 DSH 执行会话；执行会话按独立 Executor Graph 生成计划并运行。
- 提供 `pangea_environment_get`、`pangea_ssh_exec/start/read/stop/interactive` 工具，支持普通命令、持续 IO 后台任务和同一阵列 PTY 内的 `diagnose_usr → attach → dtoe` 交互。
- 在当前分析 Run 下展示对应的 Executor Run、计划、结果和 `UNRESOLVED` 原因。

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

PANGEA Tab 提供中文运行监控与结果浏览器：

- 固定顶部导航：`总览 / 风险 / 用例 / 证据 / 复核`，任何页面都能直接跳转；总览是默认入口。
- Companion 不重复展示 DSH 已有的 Agent / Tool / Subagent / Workflow 轨迹；总览只聚焦 PANGEA 阶段、进度、质量、风险、用例、证据和复核。
- 即使原 DSH 会话已删除，历史 Run 的风险、用例、证据、复核和报告仍可查看；Companion 不保存 DSH 执行时间线。
- 详情页固定提供 `← 返回`，使用页面栈按真实访问路径退回；例如 `风险 → 用例 → 风险` 可以逐级返回，不会钻进死胡同。
- 总览顶部显示 Reader 数据状态、数据源和报告对账结果。
- Reader 判定 `trusted=false` 时，详情页也持续显示告警；风险/用例空列表会明确提示“当前列表不可信”，不会显示普通的“没有数据”。
- 总览里的风险、用例、证据、复核问题卡片可直接进入对应列表。
- 风险列表支持关键词搜索和严重度筛选；风险详情展示触发条件、系统结果、外部观察、排除条件、上游语义核对、证据和关联用例。
- 测试用例列表支持搜索；详情展示前置条件、执行步骤、预期结果、观察点、清理动作，并可跳回关联风险。
- 证据列表支持搜索；详情展示源码/资料位置、观察结论和关联风险。
- 复核页展示 Reviewer、复核结论和每条 review issue 的原因/要求修改。
- 风险、用例和证据详情页可把当前对象及其直接关联内容加入 DSH 会话输入框，支持综合判断、证据检查、改写测试语言和查找覆盖缺口。
- 风险详情会把“系统结果”拆成可选结论；可以勾选任意数量的源码证据，只核对当前结论与选中证据，或把这组局部上下文转成定向测试。
- 风险详情在同一张源码卡片中提供多证据选择器，默认预览首条可读取证据；切换时不离开当前风险。证据详情预览当前证据，源码片段显示真实行号，并轻量标出 PANGEA 指向的行范围。
- “连同源码加入会话”会把当前对象、关联项和可见源码片段一起写入 DSH 草稿，不会自动发送。
- 证据详情可在 Better Sidebar 中打开完整文件；总览可直接打开 `report.html` 或 `report.md`。Better Sidebar 当前公开接口不支持指定光标行号，因此 Companion 在自己的预览卡片中完成准确行号定位，不伪装成编辑器已跳转。
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
pangea-agent analysis artifacts  <- read only -  dsh-pangea-companion
pangea-agent executor Graph      <- DSH execution session follows actions
dsh-ssh host configuration       <- aliases/passwords - Companion SSH tools
```

禁止 Companion：

- 调用 PANGEA CLI 推进原分析 Run。
- 修改 `progress.json`、`final-state.json`、task/result 文件。
- 替 PANGEA 实现 analysis/review/rework 状态机。
- 把 DSH 或 Companion 依赖反向引入 `pangea-agent`。

因此卸载 DSH 或 Companion 后，PANGEA 原分析流程仍可由 OpenCode、Claude Code 或其他兼容 Agent Runtime 按原流程完整运行；仅主机加阵列的环境执行能力不可用。

## 用例执行准备

1. 使用 dsh-ssh 配置主机和阵列 alias，可使用密码登录。
2. 将内部 Python 自动化仓库放到 `pangea-data/test-automation/<automation_id>/`。
3. 在 Companion“执行”页创建环境，填写两个 alias、`automation_id` 和当前环境需要的设备绑定。
4. 回到“用例”页勾选用例和环境，点击“一键执行”。

Companion 的交互 SSH 当前支持直接连接；若 dsh-ssh alias 配置了 ProxyJump，执行前会明确报 `UNRESOLVED/EXECUTION_FAILED`，不会改用另一条连接路径。

## 在 DSH 中讨论 PANGEA 对象

在 PANGEA Tab 中打开一条风险、测试用例或证据，点击“加入当前会话”。Companion 会把当前对象、直接证据和关联项写入当前 DSH 输入框，但不会自动发送。你可以检查内容、继续补充问题，然后由 DSH 回答。

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

当前测试覆盖：原分析结果读取、报告/结构化计数核对、历史 Run 摘要、会话关联、环境保存、真实 DSH 执行会话启动、Executor Run 展示、SSH 工具注册、客户端执行入口和原有证据交互。
