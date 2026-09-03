# dsh-pangea-asset-catalog

该插件在 DSH Desktop 中提供 PANGEA“资产”页。页面直接调用 `pangea-agent` 的稳定 JSON CLI，不再扫描 inbox 生成另一套目录或审核文件。

支持：

- 导入前预览文件名、大小、SHA256、Semantic/Evidence 归类和同名冲突；重复内容拒绝导入，同名内容由用户明确选择独立资产或已有资产的新修订；
- 服务端分页，并按 Semantic/Evidence、状态、类型、标题、ID 或路径筛选和搜索；
- 通过 pangea-agent 的确定性 CLI 完成规范化和 Coverage 解析，不创建提取模型会话；
- 查看提取状态和结构化结果；
- 人工批准或拒绝历史缺陷提取结果；
- 编辑标题、关联仓库、模块和语言标签；
- 废弃及恢复资产，下载失败记录；
- 勾选一个或多个“可用于分析”的资产，直接带入“新建分析”表单。

历史缺陷提取完成后必须人工审核，审核通过后才会成为后续 Run 的候选输入。Coverage 由 Python 直接解析，不启动模型会话。没有结构化条目的资料保留“已分析，无结构化条目”状态。

结构化结果优先显示为可浏览的条目卡片；无法识别的结果仍保留原始 JSON。用例示例也是资产，
只能在 Step 07 作为格式和粒度参考，不作为用户在新建分析中手写的上下文。

插件要求当前 DSH 工作区是 `pangea-agent` 仓库，并优先使用仓库 `.venv` 中的 Python。

验证：

```bash
cd plugins/dsh-pangea-asset-catalog
npm test
```
