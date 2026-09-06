# ACP 续接与风险详情缺失 Bug Report

## 现象

- OpenCode 在 Codetalks Run 尚未完成时结束一次回答，宿主随即释放 ACP 会话，任务被结算为“未形成正式交付”。
- Lua Run 已发布 11 条风险，但严重度为小写英文，客户端四级筛选均为空。
- 风险活文档使用 `R-*`、长破折号标题和加粗长标签，Reader 未提取六段因果说明，详情只剩源码、证据和关联用例。

## 触发条件

- ACP `session/prompt` 返回 `end_turn`，而磁盘 Run 仍处于 Step 01–09 的中间阶段。
- 工作台投影使用 `high/medium/low`，或风险章节使用当前 Lua Skill 的标题、标签格式。
- 投影中的空字符串覆盖同一 risk_id 的活文档正文。

## 根因

1. Provider 只暴露首次 `result`，并把 `end_turn` 映射为整个 Job 的 `completed`；PANGEA 在检查 Run 之前已进入释放流程。
2. Reader 未统一严重度枚举，客户端却只按 `Critical/High/Medium/Low` 精确匹配。
3. 风险解析器只支持历史 `RP-*` 和短标签，且投影合并没有区分空值与有效值。
4. 风险详情和讨论草稿未消费完整因果字段。

## 修复

- ACP 句柄增加同进程、同 sessionId 的串行 `continuePrompt()`；PANGEA 每轮结束后读取真实 Run 状态，正式交付通过后才结束。
- 连续两次续接没有有效进展时停止自动续接，通过机器码跨越只支持三种终态的 Job 层，在 TaskStore 持久化为 `needs_attention` 并保留原因。
- Reader 统一规范严重度，支持 `R-*`/`RP-*`、多种标题分隔和六段因果标签；空投影字段不再覆盖活文档。
- 风险筛选显示各级数量和未分级数量；详情、搜索与讨论上下文使用同一份完整风险数据。
- Skill 投影 schema 与 Step 05/09 说明补齐字段语义，但不把缺项升级成整个 Run 失败。

## 回归证据

- Companion `npm test`：108/108 通过。
- Agent `unittest discover`：12/12 通过。
- Desktop `npm run typecheck` 通过；依赖干净重装后 ACP patch 契约测试 2/2 通过。
- OpenCode 1.18.28 实测：同一 ACP 进程连续两轮 prompt，原始 stop reason 均为 `end_turn`。
- 真实 Lua Run 只读重放：11 条风险；严重/高/中/低为 0/2/8/1，R-001 六段因果字段均可读取。
