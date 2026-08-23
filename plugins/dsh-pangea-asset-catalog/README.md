# dsh-pangea-asset-catalog

`dsh-pangea-asset-catalog` 是一个独立的 DSH 插件。它只读扫描：

- `pangea-data/inbox/`；
- `pangea-data/test-automation/`。

然后在 `pangea-data/asset-catalog/` 生成非约束性的资产目录。插件不会修改
`pangea-agent`、Graph、schema、rubric、Run、报告、原始资料或自动化代码，也不会替
PANGEA 决定资料应该如何参与分析。

## 输出

```text
pangea-data/asset-catalog/
├── catalog.json
├── materials/
│   └── <asset_id>.json
├── methodology-candidates.json
├── automation-capabilities.json
├── diagnostics.json
└── overrides.json                 # 只有人工修正建议分类后才出现
```

- `catalog.json`：所有已发现资产及插件建议角色。
- `materials/`：资料标题、需求 ID、符号、声明限制和原文位置。
- `methodology-candidates.json`：只保存 `draft` 候选，不会自动成为 PANGEA 方法论。
- `automation-capabilities.json`：脚本入口候选、参数名、环境变量名，以及
  precheck/setup/action/assertion/cleanup 的源码位置；不保存密码或参数值，不执行脚本。
- `diagnostics.json`：缺失目录、无法读取、超限和未解析文件。

所有输出都包含 `non_binding` 或等价说明，供未来的 PANGEA 适配层自行选择是否读取。

## 支持范围

首版解析 Markdown、TXT、JSON、YAML、常见脚本与源码文本。PDF、DOCX 和 XLSX 会被
发现并写入诊断，但在不新增依赖的前提下不解析正文，不会伪装为已分析。

## DSH 使用

安装 `dsh-pangea` 基座后，插件会在 Better Sidebar 中注册原生“资产”页签。页面可以：

- 查看实时扫描预览；
- 明确生成目录文件；
- 按建议角色筛选；
- 人工修正主要建议角色。

也可以在 DSH 会话调用 `pangea_asset_catalog_generate`。该工具只生成上述目录文件。

## 安装

从仓库根目录执行：

```bash
npx @deepseek-ai/dsh plugin --profile web add "file:$PWD/plugins/dsh-pangea"
```

## 验证

```bash
cd plugins/dsh-pangea-asset-catalog
npm test
```
