# dsh-pangea-asset-catalog

该插件在 DSH Desktop 中提供 PANGEA“资产”页。页面直接调用 `pangea-agent` 的稳定 JSON CLI，不再扫描 inbox 生成另一套目录或审核文件。

支持：

- 导入需求、设计、历史缺陷、参考资料和 Coverage；
- 服务端分页，并按类型、标题、ID 或路径搜索；
- 在 DSH 会话中执行结构化提取；
- 查看提取状态和结构化结果；
- 人工批准或拒绝历史缺陷提取结果；
- 归档资产。

历史缺陷提取完成后必须人工审核，审核通过后才会成为后续 Run 的候选输入。Coverage 由 Python 直接解析，不启动模型会话。没有结构化条目的资料保留“已分析，无结构化条目”状态。

已有用例不进入资产管理。用户可以在创建单次 Run 时提供少量用例示例。

插件要求当前 DSH 工作区是 `pangea-agent` 仓库，并优先使用仓库 `.venv` 中的 Python。

验证：

```bash
cd plugins/dsh-pangea-asset-catalog
npm test
```
