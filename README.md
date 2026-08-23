# dsh-pangea

这个仓库提供 PANGEA 在 DSH 中的统一工作台。远端仓库名是 `dsh-pangea`；本地克隆目录
不需要改名，继续使用现有路径即可。

## 结构

```text
dsh-pangea/
├── plugins/
│   ├── dsh-pangea/                    # 工作台基座与页面注册 API
│   ├── dsh-pangea-companion/          # 分析与执行功能
│   └── dsh-pangea-asset-catalog/      # 资产分析与目录生成
├── docs/
├── scripts/
├── templates/
└── README.md
```

浏览器侧的关系固定为：

```text
dsh-better-sidebar
        ↓
dsh-pangea 基座（唯一 PANGEA Tab、ctx.pangea）
        ↓
Companion「分析 / 执行」页、Asset Catalog「资产」页
```

`dsh-better-sidebar` 继续负责通用的侧栏、编辑器、终端、文件浏览等能力。`dsh-pangea`
只负责 PANGEA 顶层入口和功能页注册，不重复实现通用侧栏。

## 插件职责

### dsh-pangea

- 向 Better Sidebar 注册一个单实例 `PANGEA` Tab。
- 提供 `ctx.pangea.registerPage()`、`openPage()`、`openFile()`、`getPages()` 和
  `subscribe()`。
- 按会话记住当前功能页；插件卸载或热重载时自动移除对应页面。
- 隔离单个功能页的渲染错误。
- 不读取 Run、不扫描资产、不执行用例，也不改变 PANGEA 决策。

### dsh-pangea-companion

- “分析”页读取并展示 PANGEA Run、风险、用例、证据与复核结果。
- “执行”页维护执行环境和独立 Executor 会话。
- 提供 `pangea_status`、环境、执行和 SSH 工具。
- 只读消费 PANGEA 分析产物，不修改分析 Run、Graph 或状态机。
- 仅在 PANGEA 工作区调整 `subagent-report` 的唤醒时机。

详细说明见 [`plugins/dsh-pangea-companion/README.md`](plugins/dsh-pangea-companion/README.md)。

### dsh-pangea-asset-catalog

- 只读扫描 `pangea-data/inbox/` 与 `pangea-data/test-automation/`。
- 区分输入候选、语义参考、示例参考、方法论候选与自动化能力。
- 只在用户明确生成时写入 `pangea-data/asset-catalog/`。
- 生成结果全部是非约束性引用材料，不修改 `pangea-agent`、原始资产、Run、Graph、
  schema、rubric 或 PASS/FAIL 决策。

详细说明见 [`plugins/dsh-pangea-asset-catalog/README.md`](plugins/dsh-pangea-asset-catalog/README.md)。

## 安装

以下命令从仓库根目录执行。当前环境使用 Better Sidebar 0.13.1，因此这里固定版本，
不使用 `@latest`：

```bash
npx @deepseek-ai/dsh plugin --profile web add dsh-better-sidebar@0.13.1
npx @deepseek-ai/dsh plugin --profile web add "$PWD/plugins/dsh-pangea"
npx @deepseek-ai/dsh plugin --profile web add "$PWD/plugins/dsh-pangea-companion"
npx @deepseek-ai/dsh plugin --profile web add "$PWD/plugins/dsh-pangea-asset-catalog"
```

确认安装：

```bash
npx @deepseek-ai/dsh plugin --profile web list --depth 0
```

应至少看到：

```text
dsh-better-sidebar
dsh-pangea
dsh-pangea-companion
dsh-pangea-asset-catalog
```

启动或重启 DSH Web 后硬刷新页面：

```bash
npx @deepseek-ai/dsh web --host 127.0.0.1 --port 3080
```

Better Sidebar 的 `+` 菜单只会出现一个 `PANGEA` 入口。打开后，顶部会按已安装插件
显示“分析”“执行”“资产”。缺少某个功能插件时只隐藏对应页面，不影响其他页面。

## 开发验证

```bash
cd plugins/dsh-pangea && npm test
cd ../dsh-pangea-companion && npm test
cd ../dsh-pangea-asset-catalog && npm test
```
