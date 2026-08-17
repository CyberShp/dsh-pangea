# DSH 插件管理项目

这个仓库用于集中存放和管理 DSH 插件。目前提供 `dsh-pangea-bridge`：让用户在 DSH Web 中直接用自然语言启动并完成一轮 PANGEA 分析。

## 目录结构

- `plugins/`：各个 DSH 插件，每个插件使用独立子目录。
- `scripts/`：插件管理、检查和发布脚本。
- `docs/`：项目说明和插件开发规范。
- `templates/`：新插件可复用的基础模板。

## dsh-pangea-bridge 做什么

安装后，DSH 会获得两个工具：

- `pangea_analyze`：完整流程入口。创建或恢复 PANGEA Run，派发分析 Worker，执行独立复核，必要时完成一次返工，最后生成报告。
- `pangea_run`：低层入口。只创建或恢复 Run，并返回当前阶段和任务文件，不自动执行 Worker。

正常聊天使用 `pangea_analyze` 即可，不需要手动调用工具名。

## 准备条件

开始前确认：

1. DSH 可以通过 `npx @deepseek-ai/dsh --help` 启动。
2. PANGEA 位于本机，例如 `/Volumes/Media/pangea-agent`。
3. PANGEA 的 Python 环境可用，例如 `/Volumes/Media/pangea-agent/.venv/bin/python`。
4. 待分析仓库位于 PANGEA 数据目录的 `repositories/` 下。

推荐的数据目录结构：

```text
/path/to/pangea-data/
├── repositories/
│   └── my-repo/
├── inbox/
├── coverage/
└── runs/
```

其中：

- `data_root` 是 `/path/to/pangea-data`。
- `repository` 是 `my-repo`，也就是 `repositories/` 下的目录名。
- `source_scope` 是仓库内的相对路径，例如 `src/target.c` 或 `lib/socket/`。

如果希望 PANGEA 最终给出 `COMPLETE / PASS`，待分析仓库需要是具有有效提交的独立 Git 仓库。这是 PANGEA 自己的源版本门禁。

## 安装插件

在终端执行：

```bash
npx @deepseek-ai/dsh plugin --profile web add /Volumes/Media/dsh/plugins/dsh-pangea-bridge
```

这里必须使用插件目录的绝对路径。如果仓库不在 `/Volumes/Media/dsh`，请换成实际路径。

确认插件已经进入 DSH Web profile：

```bash
npx @deepseek-ai/dsh plugin --profile web list --depth 0
```

输出中应出现：

```text
dsh-pangea-bridge
```

本地插件以链接方式安装。以后修改插件源码，不需要重复安装，但需要重启 DSH Web 才能加载新代码。

## 启动或重启 DSH Web

如果 DSH Web 正在运行，先在原终端按 `Ctrl+C` 停止，然后重新启动：

```bash
npx @deepseek-ai/dsh web --host 127.0.0.1 --port 3080
```

浏览器打开：

```text
http://127.0.0.1:3080
```

进入页面后，添加一个同时能够访问 PANGEA 项目、数据目录和待分析仓库的工作区。例如它们都在 `/Volumes/Media` 下时，选择 `/Volumes/Media`。

## 在 DSH 中联动 PANGEA

新建一个“标准模式”会话，直接描述任务：

```text
请用 PANGEA 分析 /path/to/pangea-data 里的 my-repo 仓库。
目标是 target_api，源码范围是 src/target.c，重点检查异常输入和错误恢复。
PANGEA 项目在 /Volumes/Media/pangea-agent，请跑完整流程并返回报告。
```

DSH 会整理以下信息并调用 `pangea_analyze`：

```json
{
  "data_root": "/path/to/pangea-data",
  "repository": "my-repo",
  "target": "target_api",
  "source_scope": ["src/target.c"],
  "focus": ["异常输入", "错误恢复"],
  "pangea_root": "/Volumes/Media/pangea-agent"
}
```

如果缺少数据目录、仓库名、分析目标或源码范围，DSH 会先询问，不会自行猜测源码范围。

## 执行过程

一次完整任务按下面的顺序运行：

1. 创建任务 contract，或恢复已有 Run。
2. 由 PANGEA 拆分分析单元。
3. DSH 使用原生子 Agent 执行分析 Worker，最多并发 4 个。
4. PANGEA 校验每个 Worker 结果。
5. 一个独立 Reviewer 进行复核。
6. 只有 PANGEA 明确要求时才返工，最多一次，并由原 Reviewer 继续验证。
7. 生成 `report.md` 和 `report.html`。

插件不修改 PANGEA 源码，也不增加签名、回执或额外审计 Agent。

## 查看结果

运行结果位于：

```text
<data_root>/runs/<run_id>/
├── progress.json
├── report.md
└── report.html
```

`progress.json` 中常见终态：

- `phase: COMPLETE` 且 `quality_status: PASS`：分析、复核和报告门禁全部通过。
- `phase: INCOMPLETE`：流程已经诚实停止，需要查看同一 Run 的质量状态和报告说明。

## 恢复已有 Run

告诉 DSH 原来的数据目录和 `run_id`：

```text
请继续 PANGEA Run sample-api-complete。
数据目录是 /path/to/pangea-data，PANGEA 项目在 /Volumes/Media/pangea-agent。
```

插件会读取该 Run 已冻结的 contract，从当前阶段继续，不会重新创建或改写任务范围。

## 常见问题

### DSH 看不到 `pangea_analyze`

先检查插件清单，然后重启 DSH Web：

```bash
npx @deepseek-ai/dsh plugin --profile web list --depth 0
```

### DSH 无法访问 PANGEA 或数据目录

重新选择包含这些目录的共同父目录作为 DSH 工作区。

### 最终状态是 `source_version_unverifiable`

确认 `data_root/repositories/<repository>` 本身是独立 Git 仓库，并且具有有效提交，然后使用新的 `run_id` 重新分析。

### PANGEA Python 启动失败

确认下面的命令可以正常执行：

```bash
/Volumes/Media/pangea-agent/.venv/bin/python -m pangea_agent.cli.main --help
```

## 开发与验证

```bash
cd /Volumes/Media/dsh/plugins/dsh-pangea-bridge
PANGEA_ROOT=/Volumes/Media/pangea-agent \
PANGEA_PYTHON=/Volumes/Media/pangea-agent/.venv/bin/python \
npm test
```

插件的参数和实现边界另见 [`plugins/dsh-pangea-bridge/README.md`](plugins/dsh-pangea-bridge/README.md)。
