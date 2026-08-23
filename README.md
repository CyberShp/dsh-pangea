# DSH 插件管理项目

这个仓库用于集中存放和管理 DSH 插件。目前提供 `dsh-pangea-companion`：一个安装包同时包含 PANGEA 只读工作台和仅对 PANGEA 工作区生效的消息唤醒策略，不执行或改写 PANGEA 工作流。

## 目录结构

- `plugins/`：各个 DSH 插件，每个插件使用独立子目录。
- `scripts/`：插件管理、检查和发布脚本。
- `docs/`：项目说明和插件开发规范。
- `templates/`：新插件可复用的基础模板。

## dsh-pangea-companion

`pangea-agent` 本身已经定义完整的 Contract、Graph、Worker、Review、Rework、Validation 和 Report 流程。DSH workspace 直接指向 `pangea-agent` 后，DSH 可以依据项目指令运行原生 PANGEA 流程，因此 Companion 不再维护第二套调度器。

Companion 的职责固定为：

```text
PANGEA = 工作流与结构化产物的唯一真相
DSH = Agent Runtime 与交互工作台
Companion = 只读状态 / 产物适配层 + DSH 唤醒策略
```

当前能力：

- 自动从 DSH workspace 发现 `pangea-data/runs/`。
- `pangea_status` 读取当前/指定 Run 的 phase、quality、analysis 进度、风险、测试用例、证据和错误。
- `监控` 页面合并当前 DSH Agent 状态、工具/子 Agent 活动与 PANGEA 阶段；删除原会话后，历史 Run 仍保留最小运行摘要。
- `GET /api/pangea-companion/state` 为 Web UI 提供同源只读状态。
- 若安装 `dsh-better-sidebar`，自动注册一个单实例 `PANGEA` Tab；未安装时不影响 Core 和工具。
- 风险、用例和证据详情可把局部上下文加入当前 DSH 会话；风险页可拆分系统结论、勾选多条证据并执行定向核对或生成定向测试，源码按真实行号预览；完整证据文件和最终报告可在 Better Sidebar 中直接打开。
- PANGEA 工作区的 `subagent-report` 只投递信息、不提前唤醒根 Agent；子 Agent 真正 `settled` 后再由 DSH 原生通知唤醒。其他工作区行为不变。

详细说明见 [`plugins/dsh-pangea-companion/README.md`](plugins/dsh-pangea-companion/README.md)。

## 安装 Companion

克隆仓库并进入项目目录：

```bash
git clone https://github.com/CyberShp/dsh-pangea.git
cd dsh-pangea
```

如果之前安装过旧版 `dsh-pangea-bridge`，先卸载：

```bash
npx @deepseek-ai/dsh plugin --profile web remove dsh-pangea-bridge
```

需要侧栏结果浏览器时，安装 Better Sidebar：

```bash
npx @deepseek-ai/dsh plugin --profile web add dsh-better-sidebar@latest
```

从仓库根目录安装 Companion：

```bash
npx @deepseek-ai/dsh plugin --profile web add "$PWD/plugins/dsh-pangea-companion"
```

确认：

```bash
npx @deepseek-ai/dsh plugin --profile web list --depth 0
```

应看到：

```text
dsh-pangea-companion
```

推荐把 DSH workspace 直接设置到 `pangea-agent` 根目录。Companion 会自动发现：

```text
pangea-agent/
└── pangea-data/
    └── runs/
```

## dsh-better-sidebar

Companion 不强依赖 `dsh-better-sidebar`。如果已安装该插件，PANGEA Cockpit 会通过它公开的 `ctx.betterSidebar.registerTab()` 服务注册为原生侧边栏 Tab。

没有安装 better-sidebar 时，Companion 仍然保留 Host Reader 和 `pangea_status` 能力。

## 启动 DSH Web

```bash
npx @deepseek-ai/dsh web --host 127.0.0.1 --port 3080
```

## 开发与验证

```bash
cd plugins/dsh-pangea-companion
npm test
```
