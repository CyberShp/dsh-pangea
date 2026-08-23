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
├── normalized/
│   └── <asset_id>.md
├── materials/
│   └── <asset_id>.json
├── methodology-candidates.json
├── automation-capabilities.json
├── diagnostics.json
└── overrides.json                 # 只有人工修正建议分类后才出现
```

- `catalog.json`：所有已发现资产及插件建议角色。
- `normalized/`：从 `inbox/` 中的 DOCX、PDF、XLSX 提取出的 Markdown，带原文件、页码、
  工作表或内容块位置，供 PANGEA 后续适配层读取和引用。
- `materials/`：资料标题、需求 ID、符号、声明限制和原文位置。
- `methodology-candidates.json`：只保存 `draft` 候选，不会自动成为 PANGEA 方法论。
- `automation-capabilities.json`：脚本入口候选、参数名、环境变量名，以及
  precheck/setup/action/assertion/cleanup 的源码位置；不保存密码或参数值，不执行脚本。
- `diagnostics.json`：缺失目录、无法读取、超限和未解析文件。

所有输出都包含 `non_binding` 或等价说明，供未来的 PANGEA 适配层自行选择是否读取。

## 支持范围

插件直接解析 Markdown、TXT、JSON、YAML、常见脚本与源码文本。对于
`pangea-data/inbox/` 中的文档：

- DOCX：保留标题、段落、列表和表格，图片暂不提取；
- PDF：按页提取文字，扫描版或纯图片 PDF 不做 OCR，会明确报告无法提取；
- XLSX：按工作表输出带行号、列名的 Markdown 表格，公式同时保留缓存结果和公式文本。

原文件不会被覆盖或移动。只有点击“生成目录文件”或调用生成工具后，Markdown 才会写入
`pangea-data/asset-catalog/normalized/`。旧版 `.doc`、`.xls`、受密码保护、损坏或超过
25 MiB 的文件不会伪装成转换成功，原因会进入 `diagnostics.json`。

本阶段只完成“文档转 Markdown”和原有建议分类，不会从用户上传的历史问题中提取问题，
也不会生成新的方法论；这些属于下一阶段。

## DSH 使用

安装 `dsh-pangea` 基座后，插件会在 Better Sidebar 中注册原生“资产”页签。页面可以：

- 查看实时扫描预览；
- 查看文档是否可转换，并在生成后打开对应 Markdown；
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
