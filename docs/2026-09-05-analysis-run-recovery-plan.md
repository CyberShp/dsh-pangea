# 分析运行一致性与 AI 助手展示修复 Implementation Plan

**Feature:** 本次 Run 启动、执行关联和助手展示修复；项目未设置本项 Feature 编号。
**Goal:** 分析执行可可靠启动、跟踪、停止和续跑，过程输出位于右侧 AI 助手，任务与结果状态始终准确。
**Acceptance Criteria:** AC-1 至 AC-9，见下文；全部满足才交付。
**Architecture cell:** 现有 dsh-pangea 产品壳与 dsh-pangea-companion；未发现项目使用 ownership cell 编号。
**Map delta:** none。
**Map delta why:** 使用现有 Jobs、Subagents、TaskStore 与 React 会话布局，不新增运行平台或改动分析引擎。
**Architecture:** 必要状态保存与诊断日志分离；每次分析使用明确的 attempt/owner/job 身份。界面从执行、发布、读取及质量信息派生展示，在原生会话区域挂载单实例助手。
**Tech Stack:** JavaScript、React 18、Cordis 4、当前锁定的 DSH Jobs/Subagents、node:test、Desktop Vitest、Windows Electron。
**前端验证:** Yes。必须用实际浏览器/Electron 测量布局并截图；静态代码匹配不属于布局验收。
**执行人:** Luna max；本文是待实施方案，不代表修复或测试已经完成。

## 1. 完成标准与范围

- **AC-1：可靠启动。** 在真实 Cordis Context 和 Jobs 实现下完成启动，不读取不存在的 runtime 属性；ACP 执行前已持久化完整关联。
- **AC-2：准确结算。** 快速成功、快速失败、停止、迟到回调均不丢失终态；旧 attempt 不覆盖当前 attempt。
- **AC-3：安全续跑。** 确认旧执行结束后，沿用原 Run、源码快照、产物和检查点，只新增执行 attempt；不能重复启动同一 Run。
- **AC-4：正确位置。** 分析过程完整出现在右侧 AI 助手区域，不遮挡中间任务、运行细节或文件，不遮挡可用的输入/审批控件。
- **AC-5：身份一致。** 任务、Run、attempt、分析 owner session、讨论 session 明确关联；切任务或会话无旧输出串入。
- **AC-6：准确展示。** 失败/停止任务不显示“阶段结果生成中”；未发布的数据不显示已确认的零；草稿可读不等于分析质量通过。
- **AC-7：导航保真。** 从具体 Run 打开运行细节再返回、打开文件再关闭，仍回到同一个 Run，并保留所选会话。
- **AC-8：兼容与数据保留。** 旧 tasks-v1.json 可读取，历史 attempts/会话/错误保留；升级不会自动重跑、清空用户数据或猜测旧 Job 归属。
- **AC-9：成品验证。** 本次源码构建出的实际 Windows 包通过真实框架集成测试与页面验收；记录组件提交及验证证据。

本次开发范围是上述完整故障链。九步分析方法、并行策略、模型继承策略、资产提取、导出能力保持现状。既有返回/文件导航行为作为回归项，不借此重做全站导航。

## 2. 基线与事实

### 2.1 工作目录

- 插件源码：`D:/pangea-source/dsh-pangea-analysis-redesign`，审计基线 `cb925d19b142e22d7cbe5ee6ef5a656603e5ef01`，分支 `codex/analysis-workbench-redesign`。
- Desktop 源码：`D:/pangea-source/pangea-desktop-analysis-redesign`。当前组件清单锁定上述插件提交；开工时重新检查 HEAD、diff 和组件清单。
- 当前运行安装：`D:/Agent/pangea-desktop`。`D:/pangea-desktop` 也是安装目录，不是本次源码仓库。
- pangea-agent 保持清单中的 `a01bb876f25704d4864d445f2de5afcf6eac5b93`，本修复无须改分析 Skill。
- 最终插件集成目标仍为 `codetalks-skill`。实际开发从包含上述基线的隔离分支进行，合入与发布按后续授权执行。

开工时保留所有已有改动。Desktop 当前存在 `pangea.components.json`、`scripts/build-pangea-desktop.ps1`、`test/release.test.ts` 的未提交修改；不得重置、覆盖或默认为本轮改动。

### 2.2 已确认根因

1. `plugins/dsh-pangea-companion/src/index.js` 的 `runtimeInstanceId()` 访问 `ctx.runtime_instance_id` / `ctx.instance_id`。Cordis 插件 Context 是受注入规则约束的 Proxy；可选链不会绕过它的 getter。真实 Jobs API 不提供这两个字段。审计用安装包的 Cordis 隔离复现了同一异常。
2. `launchAnalysisSession()` 返回之后才执行 `bindJob()`。实际日志是 Job 创建成功、skill_started、launch_failed，随后 ACP 会话仍创建成功；持久任务的 job_id 却为空。
3. `emitLaunch()` 会吞掉回调异常。当前必须成功的 Run 绑定混在诊断回调里，不能依赖它完成持久化。
4. 真实 `jobs.start()` 同步进入 `spec.run()`，当前实现立即启动 ACP。所以仅把 bindJob 移到 jobs.start 返回后，还不能保证先保存关联再启动 Agent。
5. `AssistantProcess` 属于中间 ProductShell 的 DOM 子树。祖先 Better Sidebar panel 的 `contain: layout style` 改变 fixed 定位参照，导致 `right: 0` 把过程面板放在中间区域右侧。
6. publication=pending 被直接翻译为“阶段结果生成中”；healthStyle 将非 error/warning 的状态默认涂绿。任务已失败的状态没有参与这两项展示。

根因追溯提交：身份访问 `08bf476`；过程面板 `ea54fcee`；pending 展示链 `6d1de38`。以上是定位依据，不要求回退这些提交。

## 3. 后端最终设计

### 3.1 真实身份契约

新建 attempt 在任何外部执行前生成并持久化 attempt_id；同一次启动全程使用捕获的不可变身份。

```ts
// Job 创建后的完整内部引用；字段来自当前 Task/Run、owner 与真实 Job snapshot。
type AttemptJobRef = Readonly<{
  taskId: string
  runId: string
  attemptId: string
  ownerSessionId: string
  jobId: string
  jobStartedAt: number
}>
```

- `ownerSessionId` 是创建 ACP Job 时传入的 owner.id；不是外部 Agent 自己的 agent_session_id。
- `jobStartedAt` 使用 `jobs.get(jobId, owner).startedAt`，原样保存为 `job_started_at`；不自行生成时间替代。真实字段为毫秒时间戳。
- 开始阶段只有 taskId/attemptId；Run、owner、Job 创建后依次补全，不能在一开始伪造完整引用。
- 读、结算、取消时核验 ownerSession 与 startedAt。Job ID 会重新从 subagent-1 开始，仅凭 ID 不够。
- 删除运行路径对 ctx.runtime_instance_id / instance_id 的探测。历史 `runtime_instance_id` 保留为旧记录字段，不再作为当前框架服务读取或必需匹配条件。
- 不向 inject 添加不存在的服务，不通过 catch 后返回 null 掩盖框架契约错误，也不使用每次插件 apply 的随机值冒充 Jobs registry 身份。
- 用明确命名的 `job_started_at` 与原有 `started_at` 区分：前者是框架 Job 身份信息，后者是本产品 attempt 的起始时间。

### 3.2 启动顺序

```text
锁定 task + 保存新 attempt(starting)
  → 创建/恢复 Run → 必须成功地绑定 Run
  → 创建 owner session → 必须成功地保存当前 attempt 与 owner
  → jobs.start 注册可取消、暂不执行 ACP 的 producer
  → 读取真实 Job snapshot → 必须成功地保存完整 Job 引用
  → 复核 attempt 仍为当前且未请求停止
  → 放行 producer → subagents.start
  → 按真实状态记录进度 / 结算
```

实现要求：

1. 扩展现有 prepareLaunch / prepareProviderLaunch，让它们创建 attempt，而不是等 bindJob 时才创建。清理当前执行镜像中的旧 Job、owner、Agent session、PID、output、error；历史留在 attempts 与 conversations。
2. `launchAnalysisSession` 增加一组明确的必要生命周期回调，如 onRunReady、onOwnerReady、onJobCreated、onAgentStarted。复用已有 onSession 能承担的职责，集中维护接口与调用点。
3. 放行前的必要回调直接 await，错误向启动调用方传播。`onEvent` 只负责 best-effort 诊断；日志失败不能跳过必要保存，也不能让成功执行变成启动失败。
4. `startAcpJob` 用一个本地 Promise 启动门实现“先注册、再绑定、后执行”。挂起 producer 仍提供正常 cancel/done；绑定失败或提前停止会结束它，不能留下永久 pending 的 Job。
5. `skill_started` 在必要保存完成、启动门放行后才发出；它表示已交给 Agent，不代表分析成功。
6. 移除 launch 返回后重复 bindJob/bindRun 的写法。立即失败的 Job 不能被返回路径重新写回 running。
7. ACP started 回调可能晚到；它必须携带原 attempt 身份，不能根据“当前最后一个 attempt”写入。HTTP 启动响应可能已返回，因此 onAgentStarted 保存失败由 producer 的 done/cancel/dispose 链处理：先保留真实 ACP run 句柄，再 await 回调；失败时取消并释放本次 ACP，按原 attempt 结算。不能只依赖外层 launch catch 或在 await start 成功后才保存 run 句柄。

### 3.3 回调、状态与取消

- `bindAgentRuntime`、`recordJobActivity`、`settleJob`、`markLaunchFailed` 和停止回调均接受捕获的 attempt 引用。
- 历史回调可以更新所属历史 attempt；只有 `task.attempt_id === ref.attemptId` 时才能更新 task 顶层当前状态、当前输出和当前 Agent session。
- task 顶层是当前 attempt 的镜像；不要新增另一份独立“是否运行”布尔值。
- 同一 attempt 的终态更新应幂等；重复事件不会重复追加最终输出或把 stopped/failed 改回 running。新的 attempt 才可以重新进入 starting/running。
- `kill()` 返回 requested 只说明已请求停止。执行仍处于 stopping，直到真实 Job 终态得到确认。
- 对已绑定 Job 的取消只操作完整身份指向的执行。启动绑定失败的清理不得依赖 TaskStore 中已经保存了身份：jobs.start 返回后立即在本次调用局部保留 jobs 实例、owner、jobId 和已取得的 snapshot。即使 jobs.get 或持久化失败，也用这个刚创建的确切句柄结束本次 Job；启动门未放行时同样必须完成 done。需要保留原始失败原因与取消失败原因。
- Run 元数据已标为 stopped，并不能证明 ACP 已退出；停止接口应分别报告 Run 标记、Job 停止、owner session 取消的结果。
- 无法确认停止时，使用现有 needs_attention/interrupted/stopping 语义表达实际情况，给出明确原因，禁止直接续跑。不要新增一套重复的运行状态机。
- 已有 onJobDone 负责异步结算；即使窗口失焦或没有 GET 请求，Job 结束也必须写入 task。保留既有读取/对账路径，不为本修复另建调度服务。

### 3.4 续跑与旧任务兼容

- 正常失败/停止且已确认执行结束：沿用 task_id、run_id、快照和检查点，新建 attempt 与 owner session。
- 继续按钮的允许条件由服务端基于当前执行身份、真实终态及 Run 可恢复状态派生；前端不能仅检查 task.status 是否 failed。
- 连续点击启动/继续，只能产生一个当前执行；starting 阶段点停止后，不得随后放行 ACP。
- 旧 tasks-v1.json 的缺省字段可读取；加载数据时不得伪造 Job startedAt 或自动开始执行。
- 截图中的坏任务缺少可靠 Job 关联：不能凭日志中的 subagent-1、PID 或最近 session 自动绑定/取消。保留现有数据，显示“旧执行停止尚未确认”。
- 该历史任务的现场恢复作为一次明确的维护操作：核对确切旧执行并确认停止，或在授权的受控 Runtime 清理后核验相关进程结束，再允许续跑。重启本身不自动等于旧进程已退出。
- 本计划的实施和测试不授权修改用户现有任务 JSON、停止用户正在运行的 Agent 或自动重跑真实分析。

## 4. 前端最终设计

### 4.1 使用真实右侧宿主

当前锁定版本的原生 DOM 中存在：

```text
[data-pane="conversation"]
  → conversation root
      → conversation.session.header
      → [data-conversation-scroll]
          → conversation.session
          → [data-composer-seat]
```

采用 ReactDOM.createPortal：

- Header 的自有宿主置于实际 conversation pane 顶部。
- Process 的自有宿主置于该 pane 的 data-conversation-scroll 中、data-composer-seat 之前。
- 两者按正常文档流排布。移除 ProductShell 下直接渲染 Header/Process 的节点、fixed 定位、视口偏移和 204px 人工占位。
- 只创建/清理自身宿主；不搬移、替换或重建原生 React root、输入框、权限面板和草稿控件。
- 一个激活 workspace 只有一个 presenter。宿主替换时重新挂载；退出分析详情、切 workspace、卸载插件时清理 portal 与订阅。
- 必需的 DOM 宿主监听应尽量限定到会话区域并有卸载清理。pane 尚不存在或被整体替换时，允许在稳定的 `#root` 子树监听 childList 来发现新 pane，找到后缩小观察范围；不能只观察已脱离文档的旧 pane。不全页轮询，也不以压缩 CSS 类名定位。
- 宿主暂未就绪时等待其挂载；最终找不到时给出可诊断的展示不可用提示，不把过程面板退回中间区域。

取舍依据：当前有 conversation.view slot，但空白 ACP owner session 下 ConversationSession 会直接返回 null。使用常驻会话宿主能覆盖本次实际故障场景，不需要修改上游会话引擎。既有 react-dom 已可用，不增加生产依赖。

### 4.2 输出身份与会话切换

扩展 `pangea:run-context` / 产品助手上下文，明确传递：

```text
workspaceKey/cwd, taskId, runId, attemptId,
ownerSessionId, jobId,
activeConversationId, activeConversationSessionId, activeConversationKind,
presentation, processOutput
```

- 所有身份取自已保存的 task、attempt、conversations 关联。当前 scope.sessionId 只表示正在看的会话，不能代替分析 owner。
- 选中任务时激活该任务的正确会话；切换任务讨论时不改变分析 Job 的 owner。
- 分析会话展示 process；任务讨论会话展示原生 Chat，只保留简短 Run 关联。完整 process 与完整 Chat 不叠在一起。
- 异步请求返回前核对 workspace/task/run/attempt。旧任务请求的输出不得覆盖新任务。
- 清理上下文也要核对所属身份，避免旧页面卸载时清空新页面刚设置的上下文。
- 原生 owner 输入是否能发送到原 ACP Agent 必须实测。若它只启动普通 DSH 模型，分析过程采用只读展示并提供“进入任务讨论”入口；不要把普通 DSH 对话呈现成对原 ACP 的续问。
- 只读过程模式仅阻断会误发的普通输入/发送动作，不得隐藏或禁用整个 data-composer-seat：该区域也承载审批、用户问题等 pending interactions，必要交互必须保持可见且可操作。切换到讨论模式后原生输入、权限、附件和草稿照常可用。这个修复不实现新的 ACP 对话传输。

### 4.3 宽窄布局与导航

- 宽屏：过程内容完全位于右侧会话列，中间只保留结论、产物、简短错误摘要和必要操作。
- 窄屏：提供明确的“AI 助手”切换入口，以单列方式显示同一个会话区域；不能在 1180px 以下直接隐藏过程而无入口。
- 长输出、展开诊断、多行草稿和权限确认不遮挡按钮。滚动按原生会话区域处理；用户正在查看旧输出时不要强制跳到底部。
- 运行细节与文件导航的恢复记录至少保留 workspace/task/run/当前页面/所选会话，不因 portal 挂卸而重置 selectedRun。

## 5. 展示状态契约

新增一个纯派生函数 `deriveRunPresentation`，供概览、助手、流程状态、数据卡和操作按钮使用。优先复用当前 client 的构建方式，不为此引入新状态库。

输入是已经合并 Task 真实执行终态的 snapshot，外加服务端给出的恢复资格。输出至少包含 executionLabel、publicationLabel、dataTone、qualityLabel、countsAvailability、isAnimating、canResume、resumeBlockedReason。

执行状态、产物发布状态、读取健康度和 Judge/validation 质量结论保持独立：

| 执行情况 | 产物情况 | 页面应显示 | 计数/颜色 |
| --- | --- | --- | --- |
| preparing/running | pending | 分析进行中；结构化结果尚未发布 | 中性；风险/用例为“尚未发布”或 — |
| preparing/running | verified draft | 阶段草稿已发布，尚未经最终复核 | 蓝色/中性；计数标“草稿” |
| failed/interrupted | pending | 分析失败/中断；尚无结构化结果 | 失败摘要红色，数据区中性；不显示生成中 |
| stopped | pending | 分析已停止；尚无结构化结果 | 中性；不显示生成中 |
| failed/interrupted/stopped | verified draft | 执行已终止；保留阶段草稿 | 显示草稿条数，不宣称正式可信 |
| completed | verified final | 正式结果已发布 | 数据可读；质量按 Judge/validation 单独判断 |
| completed 或宣称 final | missing/broken | 正式结果不可用，需要处理 | 数据告警；不将未知计数当零 |
| 任意 | 文件损坏/快照异常 | 独立显示数据读取告警 | 不覆盖真实执行状态，不因未完成而吞掉异常 |

具体要求：

- 不把所有失败强行设为 reader_health:error；执行失败不必然说明草稿损坏。
- reader_health:ok 只表示读取验证结果，不代表分析质量合格。删除 healthStyle 对未知状态默认成功的分支，pending/unknown 用中性样式。
- Reader 对“尚未存在的投影”和“已经存在但损坏的投影”分别处理；只有前者可作为预期 pending。broken 的产物不能同时 trusted=true。
- publication=pending 时原始 details 空数组只用于渲染安全，不得作为风险/用例已确认零条的依据。
- 真正验证过的空草稿可显示“草稿 0 条”；验证过的最终结果可以显示实际 0 条。
- 失败时保留已完成步数，例如“已完成 1/9，分析失败”；停止运行动画，不抹掉已有进度，也不显示仍在执行某一步。
- `PROJECTION_UNAVAILABLE` 在运行中预期尚未生成时不作为未解决故障；在应有最终结果时保留明确告警。错误诊断仍可展开查看原始 code/message。
- 单个 Run 的失败只在该 Run 的详情/任务状态中展示，不把全局工作台系统标为异常。

## 6. 实施任务与文件

以下是内部实施顺序，不是分批交付承诺。每项先建立能复现旧问题的测试，再实现并验证。

### Task 1：建立真实框架回归测试

文件：

- 新增 `plugins/dsh-pangea-companion/tests/cordis-launch.integration.mjs`。
- 扩展 `plugins/dsh-pangea-companion/tests/launch-integration.test.mjs`、`workbench-api.test.mjs`、`task-store.test.mjs`。

步骤：

1. 从指定 Desktop/成品 app 根目录解析真实 Cordis、Jobs Local 与插件依赖。测试约定环境变量 `PANGEA_TEST_APP_ROOT` 仅用于定位测试依赖，不加入生产分支。
2. 在临时 TaskStore/数据目录内，用真实 Cordis 插件 Context、真实 Jobs registry 和可控的测试 subagent 实现启动/结算。
3. 先证明当前代码出现 without inject，并能复现“绑定前 ACP 已启动”或“快速终态后被写回 running”。测试必须实际执行生产路径。
4. 缺少真实依赖应报测试环境失败，不能 skip；仅 fake 普通对象的测试不替代本项。

### Task 2：修复身份、启动门与必要保存

修改：`plugins/dsh-pangea-companion/src/index.js`、`src/workbench-api.js`、`src/task-store.js`。

执行第 3 节设计；补齐 job_started_at 读写兼容；把 Run/owner/Job 绑定移出诊断回调。保留当前外部 ACP 的模型继承行为，不重新把桌面模型值强制传给 ACP。

验证：绑定被阻塞时 ACP 未启动；绑定失败 ACP 从未启动且 Job 最终结束；日志失败仍能完成必要绑定；立即失败不会变回 running。

### Task 3：完成回调隔离、停止与续跑

修改同上三文件，必要时调整 `src/launch-log.js` 的事件字段透传及 `tests/launch-log.test.mjs`。

实施 current-attempt guard、真实取消确认、can_resume/reason 的服务端派生；保留历史兼容。日志携带 attempt 身份，界面能够区别当前执行与历史诊断。

验证：迟到旧事件、相同 Job ID 不同 owner/startedAt、重复完成、starting 时停止、连续继续、未知旧执行阻断。验证无页面轮询时仍由 onJobDone 完成持久化。

### Task 4：统一状态展示

修改：

- `plugins/dsh-pangea-companion/src/client.js`。
- `plugins/dsh-pangea-companion/src/reader.js`，仅修正发布/读取契约本身，不把执行失败写成读取失败。
- 必要的执行快照合并仍在 `src/index.js`。
- 测试：`tests/client.test.mjs`、`tests/skill-reader.test.mjs`、`tests/launch-integration.test.mjs`。

先建立第 5 节表格的参数化行为测试，再接入所有展示位置。纯函数测试断言返回文案、tone、计数可用性与动作状态，不断言源码必须含某段三元表达式。

### Task 5：将助手挂到右侧并绑定正确上下文

修改：

- `plugins/dsh-pangea/src/client.js`：portal、宿主生命周期、响应式展示。
- `plugins/dsh-pangea-companion/src/client.js`：完整上下文、会话切换和请求身份核验。
- 测试：两插件的 `tests/client.test.mjs`。

移除已失效的直接 AssistantProcess 渲染结构断言。新增行为断言并进行真实 DOM 几何验收。组件构建输出为两插件的 `lib/client.js`；只编辑 src，通过原 build 脚本生成 lib。

### Task 6：成品联调与交接

- 插件完整测试通过后，以获准的插件提交更新 Desktop `pangea.components.json`；不顺带升级 pangea-agent 或 DSH。
- 构建/CI 命令获授权后，在成品中执行同一真实框架集成测试。测试需要在原有 Harness Ready 检查之外单独报告，不合并成一个“启动成功”。
- 将业务与 UI 验收要求补到现有 Desktop `docs/development.md`；将真实框架测试接入已有 `scripts/build-pangea-desktop.ps1` / `.github/workflows/release.yml` 的成品发布前阶段时，精确合并已有未提交变更。
- 布局验收使用现有浏览器工具或 Electron 开发工具，无须新增生产依赖。若要新增浏览器测试依赖，先按仓库规则取得确认。
- 不手改安装目录 node_modules 作为正式交付，不从日常运行安装目录重新压缩出发布包。

## 7. 必测清单

| 编号 | 场景 | 必须断言 |
| --- | --- | --- |
| B01 | 真实 Cordis + Jobs 启动 | 无非法 getter；生产启动、输出、结算链实际执行 |
| B02 | bindJob 被延迟/抛错；Job snapshot 获取失败 | 放行前没有 ACP 执行；使用本次局部句柄清理；失败时没有悬挂 Job |
| B03 | Run/owner 保存失败；日志写失败；异步 onAgentStarted 保存失败 | 放行前必要保存失败阻断启动；日志失败不破坏绑定；放行后回调失败会取消/释放已取得的 ACP run 并结算 |
| B04 | ACP 立即失败/成功 | 终态不会丢失或被 launch 返回路径重写 |
| B05 | 旧 attempt 的 session/output/done 晚到 | 只更新该历史 attempt；不改变新 attempt 状态、PID、输出 |
| B06 | Job ID 重用，owner/startedAt 改变 | 识别失联；不读取或取消另一份执行 |
| B07 | starting 时停止、停止仍 requested | 无后续意外启动；未确认停止前不允许续跑 |
| B08 | 重复启动/继续、重复 terminal 通知 | 同一 Run 只有一个活动执行；结算幂等 |
| B09 | 续跑及旧 JSON 兼容 | 原 Run/快照/产物保留；新 attempt；身份未知的旧执行有明确阻断 |
| B10 | 窗口无焦点且不发送 GET | onJobDone 仍持久化真实终态 |
| B11 | Agent exit 0 但无合格最终产物 | 不能当作已完成的分析交付 |
| U01 | 空白 ACP owner，无普通 Chat turn | 右侧仍显示分析过程 |
| U02 | contain:layout style 祖先存在 | 过程不位于中间容器，不靠移除 containment 让测试通过 |
| U03 | 多窗口尺寸、缩放、长输出、多行输入/审批 | 无遮挡；窄屏有明确入口；分析只读模式下的审批/用户问题仍可见可操作 |
| U04 | 任务 A/B 快速切换、旧请求晚回 | 任务/Run/attempt/输出一致，无残留或错误清空 |
| U05 | 分析与讨论会话切换 | process 与 Chat 正确切换；draft、owner 不被改变；不误发给别的 Agent |
| U06 | 打开运行细节/返回、打开文件/关闭 | 同 Run、同会话；助手位置不变 |
| U07 | 切 workspace、列表、详情、宿主重建/插件卸载 | 单实例；自有宿主与监听器正确清理 |
| S01 | 第 5 节所有状态组合 | 文案、tone、计数、进度动画、恢复操作一致 |
| S02 | 数据损坏/最终投影缺失 | 保留真实警告；不能被 pending 隐藏 |

真实框架测试可以控制外部测试 producer 的成功/失败和输出，但不得替换 Cordis Context 或 Jobs registry 来绕开真实契约。普通单测继续保留，用来快速定位逻辑问题。

## 8. 验证命令与现场步骤

以下命令在实施完成后运行；新测试文件及环境变量接口是本方案要求新增的内容，不是当前已有能力。

### 8.1 本地源码测试

```powershell
$PluginRoot = 'D:\pangea-source\dsh-pangea-analysis-redesign'
$DesktopRoot = 'D:\pangea-source\pangea-desktop-analysis-redesign'

npm --prefix "$PluginRoot\plugins\dsh-pangea-companion" test
npm --prefix "$PluginRoot\plugins\dsh-pangea" test
npm --prefix "$PluginRoot\plugins\dsh-pangea-asset-catalog" test

$env:PANGEA_TEST_APP_ROOT = $DesktopRoot
node --test "$PluginRoot\plugins\dsh-pangea-companion\tests\cordis-launch.integration.mjs"

npm --prefix $DesktopRoot run typecheck
npm --prefix $DesktopRoot test
```

预期：相关行为测试全部通过，零跳过的必需集成测试。实际开发若使用新的 worktree，先将这两个明确的根路径改为核验后的 worktree 路径。每条命令检查退出码；不得只看最后一条成功。

### 8.2 成品框架测试

```powershell
$PackageRoot = 'D:\pangea-source\pangea-desktop-analysis-redesign\dist\win-unpacked'
$PackagedAppRoot = Join-Path $PackageRoot 'resources\app'
$PackagedNode = Join-Path $PackagedAppRoot 'node_modules\node\bin\node.exe'
$env:PANGEA_TEST_APP_ROOT = $PackagedAppRoot

& $PackagedNode --version
& $PackagedNode --test (Join-Path $PackagedAppRoot 'node_modules\dsh-pangea-companion\tests\cordis-launch.integration.mjs')
```

必须使用刚构建且身份已核对的成品目录。测试所有写入指向自身创建的临时目录，结束后仅清理这些精确路径。

### 8.3 页面验收

1. 在隔离测试 profile 和小型测试仓库中启动该成品，使用受控 Agent fixture 产生 pending、输出、失败、草稿、成功状态。
2. 覆盖 1920×1080、1366×768、1024×768，以及 Windows 125% 缩放；记录实际 CSS viewport。
3. 每个关键页面保留截图与 DOM 测量。用自有稳定标识标出过程卡与中间内容区，宽屏至少断言：

```js
const processRect = processElement.getBoundingClientRect()
const paneRect = conversationPane.getBoundingClientRect()
const centerRect = taskContent.getBoundingClientRect()
const tolerance = 1
assert(processRect.left >= paneRect.left - tolerance)
assert(processRect.right <= paneRect.right + tolerance)
assert(processRect.left >= centerRect.right - tolerance)
```

4. 在讨论模式测多行草稿、附件/权限控件和过程输出切换；在分析只读模式触发审批/用户问题，确认能看到并完成必要交互。实测点击不被透明层截获；仅矩形正确还不够。
5. 执行 U04–U07 的完整交互。空白 owner session 必须列入测试，不能只用已有 Chat 消息的会话。
6. 使用已存在的浏览器自动化工具执行并保存证据；若工具不可用，明确提交手动 Electron 验收记录及截图，不声称已完成自动化覆盖。后续增加自动化依赖需单独确认。
7. 真实外部 Agent 的连接冒烟与受控 fixture 验证分开记录；需要使用用户凭据、付费模型或真实仓库时先取得相应授权，未做则列为验收缺口。

注意：现有 `scripts/test-packaged-harness-startup.ps1` 会搬移/恢复默认 APPDATA 下的用户 profile。它适用于隔离 CI runner，不应直接在当前用户电脑上运行。不要为本任务清空或搬移用户实际 profile。

## 9. 发布前置条件与交付证据

本轮出方案不触发构建、推送、合入或发布。Luna 完成代码后的发布动作按用户授权进行。

发布时遵循现有 release-runbook：Windows 成品、锁定组件提交、同渠道、递增版本、同一正式更新签名信任链；补丁严格对应 base version。此前审计发现的版本/签名兼容问题仍是发布前置条件，本文不将它们视为已修复。

不能以以下结果单独宣称 AC 已通过：源码中出现 createPortal、字符串测试通过、Harness Ready、网页 HTTP 200、成功生成 ZIP。

交付记录包含：

- 修改的仓库、分支、提交及组件锁；哪些是已有修改，哪些是本次修改。
- B/U/S 测试编号的结果、命令、退出码、关键断言；未执行项及原因。
- 成品运行版本、插件提交、框架集成日志、关键截图与布局测量。
- 旧任务数据保留方式；是否仍有无法确认停止的旧执行。没有现场处理就明确写“未处理用户现有 Run”。
- 构建/签名/更新导入是否实测，以及对应产物位置。没有构建就不提供虚构包名或通过结论。

## 10. 交给 Luna max

**What：** 实施 AC-1 至 AC-9；以第 3–5 节的身份、挂载及状态契约作为最终行为。

**Why：** 当前故障横跨真实框架调用、启动持久化时序、异步回调、CSS 宿主与展示状态。必须让这些边界共同一致，才能可靠恢复分析。

**Tradeoff：** 保留现有 JSON TaskStore 与 Jobs/Subagents，增加一个本地启动门及真实身份字段，承担必要的生命周期测试；保留原生会话控件，以 portal 对接当前常驻 DOM。该适配受锁定的 DSH DOM 契约约束，因此升级 DSH 时需要重新跑布局验收。

**Open Questions（技术，由执行者核验并记录）：**

1. 当前源码运行环境与打包环境的依赖是否都与审计锁定版本一致；若不同，先核对真实 API 再实现。
2. 原生 owner 输入实际走哪条会话路径；按第 4.2 节决定只读过程与讨论入口，不默认它能继续原 ACP。
3. 使用哪套已可用浏览器工具保存页面验收证据；不得默默新增依赖或降级成源码正则测试。

**Open Questions（用户授权边界）：** 用户现有失联 Run 的现场停止/恢复、真实付费 Agent 测试、合入推送与构建发布，在需要执行时确认对应授权；它们不阻碍先用隔离 fixture 完成开发。

**Next Action：** 先检查工作区并建立 Task 1 的失败测试，再按 Task 2–6 实施。后端 Task 2–3 与前端 Task 4–5 可在身份/展示契约固定后并行；共享 client.js 由一人合并。全部完成后提交跨边界审查，再进入获准的发布步骤。

执行规则：按完整验收目标交付，不以最少改动行数为目标；实现、测试与成品证据一致；保留必要的失败诊断与未完成项；技术异议用代码事实和测试说明，不以附和代替核验。
