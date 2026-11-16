# 代码打桩工作区验收记录

此为首轮记录；固定个人分支改造后的当前结论见 fault-injection-fixed-branch-20261116.md。

日期：2026-11-16。基于 dsh-pangea/langgraph ab2f45c6099864b2e3f824b326e5f67e1498be01 的本地修改，未推送。

结论：功能与 DOM 交互验收通过；视觉验收和 Windows 现场验收未完成，不作为完整业务验收签收。

## 已验证

- 独立代码打桩页面注册，选分析任务后展示对应用例。
- 无选择时不能下一步；搜索过滤不丢失多选；可查看用例和打桩信息。
- 上一步保留选择及流水线配置；提交请求包含准确 run_id 和 case_keys。
- 移除例行基线按钮和勾选；保留差异信息并交给生成器按目标代码重新定位。
- 真实 Git 隔离副本生成、本地提交、推送到本地裸仓库；核验远端提交一致。
- DSH 浏览器打开按钮回调收到配置的流水线 URL（未连接真实流水线）。
- 切换分析任务不带入前一任务选择或结果；返回原任务恢复持久化详情。
- 准备源码失败记录 preparing 阶段，未调用生成器；页面展示准备源码失败及原始错误，不出现推送按钮。
- 原工作区未提交内容不进入打桩副本，原文件保留。
- 保存构建与验证结果、重新打开任务，数据一致。

## 验收中修复

1. 历史任务恢复后直接展示详情，不再混入新建向导。
2. 新建任务与历史详情分开显示。
3. 读取用例失败展示实际错误与重试按钮。
4. 新增 React 状态放在已有状态末尾，避免破坏现有按索引构造的测试夹具。
5. 更新页面注册与基线处理行为变更对应的旧断言。

## 执行结果

- `node plugins/dsh-pangea-companion/scripts/build-client.mjs`：通过，lib/client.js 已更新。
- `node --check plugins/dsh-pangea-companion/lib/client.js`：通过。
- `node --test plugins/dsh-pangea-companion/tests/*.test.mjs`：1060 项，1027 通过，0 失败，33 跳过。
- `node plugins/dsh-pangea-companion/tests/fault-injection-dom.mjs`：通过。
- `node plugins/dsh-pangea-companion/tests/fault-injection-workspace-dom.mjs`：通过，真实 React + happy-dom + 实际路由 + 实际 Git，工作台任务数据与模型输出使用测试夹具。
- `git diff --check`：通过。

测试依赖安装在 /tmp/fi-deps，仓库 node_modules 仅为本地测试符号链接；未新增产品依赖。

## 尚未验收

- Chromium 可视验收：执行 `CHROME_BIN=/usr/bin/chromium node plugins/dsh-pangea-companion/tests/fault-injection-browser.mjs`，浏览器启动因 `socket() failed: Operation not permitted` 退出。备用 headless-shell 下载失败，返回文件不是有效 ZIP。没有截图证据，不能保证视觉布局已通过检查。
- 当前环境非 Windows；33 项跳过涉及 Windows 或未提供的集成运行时。
- 生成模型是确定性测试夹具，不代表真实模型生成质量、打桩语义或业务设备验证通过。
- 长路径现场根因、212 个文件差异是否由换行符等造成，仍待内网只读取证；对应路径与比较算法未改。
- 未连接用户实际构建流水线，未构建正式 Windows 包，未推送。
