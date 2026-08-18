# DSH 插件管理项目

这个仓库用于集中存放和管理 DSH 插件。目前包含：

- `dsh-pangea-companion`：PANGEA 在 DSH 中的只读伴生工作台；提供 Run 状态感知、`pangea_status` 和可选的 `dsh-better-sidebar` Cockpit，不执行或改写 PANGEA 工作流。
- `dsh-mass-effect-theme`：为 DSH Web 提供原创的 `Normandy Command` 深色舰桥主题。

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
Companion = 只读状态 / 产物适配层
```

当前能力：

- 自动从 DSH workspace 发现 `pangea-data/runs/`。
- `pangea_status` 读取当前/指定 Run 的 phase、quality、analysis 进度、风险、测试用例、证据和错误。
- `GET /api/pangea-companion/state` 为 Web UI 提供同源只读状态。
- 若安装 `dsh-better-sidebar`，自动注册一个单实例 `PANGEA` Tab；未安装时不影响 Core 和工具。

详细说明见 [`plugins/dsh-pangea-companion/README.md`](plugins/dsh-pangea-companion/README.md)。

## 安装 Companion

如果之前安装过旧版 `dsh-pangea-bridge`，先卸载：

```bash
npx @deepseek-ai/dsh plugin --profile web remove dsh-pangea-bridge
```

然后从本仓库本地目录安装：

```bash
npx @deepseek-ai/dsh plugin --profile web add /absolute/path/to/dsh-pangea/plugins/dsh-pangea-companion
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

## 安装 Normandy Command 主题

```bash
npx @deepseek-ai/dsh plugin --profile web add /absolute/path/to/dsh-pangea/plugins/dsh-mass-effect-theme
```

重启 DSH Web 后主题会自动应用。主题只改变界面外观，不修改 PANGEA 或 Companion 数据。

## 启动 DSH Web

```bash
npx @deepseek-ai/dsh web --host 127.0.0.1 --port 3080
```

## 开发与验证

Companion：

```bash
cd plugins/dsh-pangea-companion
npm test
```

主题：

```bash
cd plugins/dsh-mass-effect-theme
npm test
```
