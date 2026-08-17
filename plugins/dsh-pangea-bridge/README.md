# dsh-pangea-bridge

让 DSH Web 直接完成一轮现有 PANGEA 模块分析。

插件提供两个工具：

- `pangea_analyze`：完整执行。创建或恢复 Run，派发 analysis worker，交给一个独立 reviewer 复核；若 PANGEA 要求返工，只返工一次，再由原 reviewer 验证，最终返回 `report.md` 和 `report.html`。
- `pangea_run`：低层入口。只创建或恢复已有 contract，并返回当前阶段和 task 路径，不自动派发 worker。

## 安装

```bash
npx @deepseek-ai/dsh plugin --profile web add /Volumes/Media/dsh/plugins/dsh-pangea-bridge
```

插件路径必须是绝对路径。安装后确认 Web profile 中已经出现插件：

```bash
npx @deepseek-ai/dsh plugin --profile web list --depth 0
```

输出中应包含 `dsh-pangea-bridge`。

第一次安装或更新插件后，重启 DSH Web：

```bash
npx @deepseek-ai/dsh web --host 127.0.0.1 --port 3080
```

本地插件以链接方式安装。修改插件源码后不需要重复安装，但需要重启 DSH Web。

## PANGEA 数据目录

`data_root` 至少应采用下面的结构：

```text
/path/to/pangea-data/
├── repositories/
│   └── my-repo/
├── inbox/
├── coverage/
└── runs/
```

`repository` 是 `repositories/` 下的目录名；`source_scope` 是该仓库内的相对路径。希望最终通过 PANGEA 的源版本门禁时，仓库本身需要有有效 Git 提交。

## 正常使用

在 DSH Web 中选择一个能够访问 PANGEA 项目和数据目录的工作区，新建“标准模式”会话后直接说，例如：

> 用 PANGEA 分析 `sock-core` 仓库的 socket 核心模块。数据目录是
> `/Volumes/Media/pangea-agent/pangea-data`，源码范围是 `lib/sock/`，重点看连接、关闭和异常恢复。

DSH 会从自然语言中整理出 `data_root`、`repository`、`target`、`source_scope` 和可选的 `focus`。缺少其中任何必要信息时，它应先询问，不会猜源码范围。

对应的工具参数示例：

```json
{
  "data_root": "/Volumes/Media/pangea-agent/pangea-data",
  "repository": "sock-core",
  "target": "socket 核心模块",
  "source_scope": ["lib/sock/"],
  "focus": ["连接", "关闭", "异常恢复"]
}
```

`repository` 是 `data_root/repositories/` 下的目录名。`source_scope` 是该仓库内的相对路径。`pangea_root` 可省略，当前默认使用 `/Volumes/Media/pangea-agent`。

需要恢复指定 Run 时，再加上原来的 `run_id`。插件会读取该 Run 已冻结的 contract，而不会重建或改写它。

完成后的主要文件位于：

```text
<data_root>/runs/<run_id>/progress.json
<data_root>/runs/<run_id>/report.md
<data_root>/runs/<run_id>/report.html
```

## 执行边界

- 最多并发 4 个 analysis worker。
- 只有 1 个独立 reviewer。
- 只有 PANGEA 明确进入 `WAITING_REWORK` 时才返工，最多一次。
- 返工后继续使用原 reviewer 会话。
- 子 Agent 看不到 DSH 的委派和工作流工具，不能继续套娃。
- 不添加 hash、签名、回执或额外审计层；PANGEA 自己的任务、校验、阶段和报告是唯一依据。
- 不修改 PANGEA 源码。

## 验证

基础测试：

```bash
npm test
```

使用真实但隔离的 PANGEA 数据目录验证 Run 创建与恢复：

```bash
PANGEA_ROOT=/Volumes/Media/pangea-agent \
PANGEA_PYTHON=/Volumes/Media/pangea-agent/.venv/bin/python \
npm test
```
