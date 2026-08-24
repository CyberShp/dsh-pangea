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
dsh-pangea（用户唯一需要安装的包）
        ├── dsh-better-sidebar 0.15.2
        ├── Companion「分析」（执行实现保留，页面暂不注册）
        └── Asset Catalog「资产」
```

`dsh-pangea` 会自动带上固定版本的 Better Sidebar、Companion 和 Asset Catalog。
Better Sidebar 继续负责通用侧栏、编辑器、终端、文件浏览等能力；`dsh-pangea` 通过
适配层调整入口，不复制 Better Sidebar 源码。

当前工作台基线要求 DSH `0.1.0-rc.8` 或更新版本。Better Sidebar `0.15.2` 已切到
rc.8+ 的客户端模块加载方式，并在 `0.1.1-rc.1` 依赖线上开发验证。

## 插件职责

### dsh-pangea

- 向 Better Sidebar 原生注册“分析”“执行”“资产”三个单实例页签，不再提供外层
  `PANGEA` 包装页。
- 提供 `ctx.pangea.registerPage()`、`openPage()`、`openFile()`、`getPages()` 和
  `subscribe()`。
- 功能插件卸载或热重载时自动移除对应页签。
- 固定 `+` 菜单顺序，并隐藏源码管理和终端菜单项。
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
- 把 `inbox/` 中的 DOCX、PDF、XLSX 转成带来源位置的 Markdown，写入
  `pangea-data/asset-catalog/normalized/`，不覆盖原文件。
- 区分输入候选、语义参考、示例参考、方法论候选与自动化能力。
- 只在用户明确生成时写入 `pangea-data/asset-catalog/`。
- 用户可对单份资产调用 DSH 模型提取历史问题，人工确认后再生成非约束性方法论候选。
- 生成结果全部是非约束性引用材料，不修改 `pangea-agent`、原始资产、Run、Graph、
  schema、rubric 或 PASS/FAIL 决策。

详细说明见 [`plugins/dsh-pangea-asset-catalog/README.md`](plugins/dsh-pangea-asset-catalog/README.md)。

## 安装

从仓库根目录只安装 `dsh-pangea`。本地目录必须带 `file:` 前缀，确保它作为一个包安装，
并自动安装 Better Sidebar、Companion 与 Asset Catalog：

```bash
npx @deepseek-ai/dsh plugin --profile web add "file:$PWD/plugins/dsh-pangea"
```

发布到包仓库后，对应命令是 `npx @deepseek-ai/dsh plugin --profile web add dsh-pangea`；
用户仍然只安装这一个包。

确认安装：

```bash
npx @deepseek-ai/dsh plugin --profile web list --depth 0
```

顶层依赖应只看到：

```text
dsh-pangea
```

启动或重启 DSH Web 后硬刷新页面：

```bash
npx @deepseek-ai/dsh web --host 127.0.0.1 --port 3080
```

PANGEA 适配后的 `+` 菜单提供：`分析 / 资产 / 文件 / 终端 / 任务管理 / 浏览器`；
Better Sidebar 0.15.2 还会显示其自带的 `侧边对话(beta)`。源码管理和 PANGEA“执行”
入口被移除，终端可直接从 `+` 菜单打开到底部面板。

## 开发验证

```bash
cd plugins/dsh-pangea && npm test
cd ../dsh-pangea-companion && npm test
cd ../dsh-pangea-asset-catalog && npm test
```
