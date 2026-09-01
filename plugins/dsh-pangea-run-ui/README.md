# dsh-pangea-run-ui

PANGEA Run 详情增强层。

- 在现有“查看运行细节”内展示完整阶段流程与持久化 Agent 分析结果，不新增独立 Agent 输出页面。
- 当前阶段使用蓝色动态态；失败、需处理、停止分别使用独立状态语义，并结合 `progress.actions` 避免与 Run Action 生命周期冲突。
- 定向补齐 / 再复核只在实际触发后出现，未触发时不展示也不解释隐藏逻辑。
- AI 助手会话与 PANGEA analysis session 隔离。
- 统一测试资产页面与 PANGEA 分析页面的字体视觉。

该插件只读取 Run 产物，不修改 PANGEA Graph 或 Run 状态。
