# ACP 停滞与原会话恢复

就绪等待默认 60 秒提示、180 秒进入取消确认；业务回合静默 3 分钟提示、10 分钟进入取消确认。取消确认窗口为 30 秒。阈值集中在 src/acp-progress.js，自动测试通过 progressPolicy 注入短阈值。

活动依据是 ACP session update 时间、消息计数和工具状态，不解析“就绪”“压缩完成”等文字作为控制指令。工具没有结束时不自动重放。取消通知发送成功不是确认，只有原 prompt 的协议返回才能确认回合结束。

确认取消后先读取当前绑定结果的 completion/revision。已有有效完成声明沿用 adapter settle；其余情况在原会话最多自动续接一次，提示仅含身份、CLI 绑定和继续指令。自动恢复次数随原 worker 写入 acp-workers.json，以 action_id 隔离，重启不会重置。已退出的进程只有在声明支持 loadSession、没有未结束工具时自动恢复，恢复必须返回相同 task/session。

取消未确认或工具状态不明时暂停并持久化 blocked，不关闭未知状态的连接以伪造取消确认。后台若收到真实原回合响应且活动工具数为零，则解除 blocked；用户后续继续仍使用原会话。若 Desktop 已退出而无法观察迟到响应，blocked 保持，不能静默清除；需要先查明原执行器状态。旧执行器缺少 cancelTurn 能力时只暂停，不自动重发。

调度保持最多三个独立 analysis/closure 并发，CLI 状态变更串行。每个 worker 完成后查询 Graph 的下一动作，无整批屏障；暂停单元不阻止其他独立单元。阶段依赖仍由 Graph 决定。整个 Run 的 busy 锁阻止重复“继续”。

定向修正原有执行预算不因自动恢复重置；上下文超限仍暂停，不发送相同超长输入。宿主只管理传输活动、身份和恢复，不拆分语义结果、不补 completion、不新增质量门禁。

验证：tests/acp-progress.test.mjs、tests/acp-recovery.test.mjs；Desktop test/agent-models.test.js 使用真实 ACP 子进程验证取消与原会话续接。
